import type { Dirent } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  realpath,
  rmdir,
  stat,
  symlink,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { type HubConfig, resolveAgents } from "../shared/config";
import type {
  BrokenLink,
  Cell,
  ErrorCode,
  LinkOp,
  ScanResult,
  Skill,
} from "../shared/contracts";
import { parseSkillDoc } from "./frontmatter";
import { gitBranch, gitPull } from "./git";

const MAX_DEPTH = 6;
const MAX_DIRS = 20_000;
const MAX_READ = 512 * 1024;
const MAX_HEADER = 64 * 1024;
const CONCURRENCY = 16;
const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

export function expandPath(input: string, home: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const expanded =
    value === "~" ? home : /^~[\\/]/.test(value) ? join(home, value.slice(2)) : value;
  return isAbsolute(expanded) ? resolve(expanded) : null;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Known failures travel as codes the client translates; OS and git errors stay raw. */
function fail(code: ErrorCode): never {
  throw new Error(code);
}

async function isDirectory(path: string | null): Promise<boolean> {
  if (!path) return false;
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * Recursively collects directories containing SKILL.md, including skills nested inside other
 * skills; `parent` is the nearest enclosing skill. Symlinked directories are not followed.
 */
export async function discover(roots: readonly string[]) {
  const found: { root: string; dir: string; parent: string | null }[] = [];
  const seen = new Set<string>();
  let visited = 0;
  let truncated = false;

  async function walk(root: string, dir: string, depth: number, parent: string | null): Promise<void> {
    if (++visited > MAX_DIRS) {
      truncated = true;
      return;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    let enclosing = parent;
    if (entries.some((e) => e.name === "SKILL.md" && e.isFile())) {
      // A directory reached again through an overlapping root keeps its first owner.
      if (seen.has(dir)) return;
      seen.add(dir);
      found.push({ root, dir, parent });
      enclosing = dir;
    }
    if (depth >= MAX_DEPTH) return;
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
        await walk(root, join(dir, e.name), depth + 1, enclosing);
      }
    }
  }

  // Sequential, so the first configured root owns overlapping skills and file handles stay bounded.
  for (const root of roots) await walk(root, root, 0, null);
  return { found, truncated };
}

/** Reads what occupies `<agent dir>/<name>` relative to the skill at `skillReal`. */
export async function inspect(linkPath: string, skillReal: string): Promise<Cell> {
  let info;
  try {
    info = await lstat(linkPath);
  } catch (error) {
    return isMissing(error)
      ? { state: "none" }
      : { state: "conflict", reason: "error", target: message(error) };
  }
  if (info.isSymbolicLink()) {
    const target = await readlink(linkPath)
      .then((raw) => resolve(dirname(linkPath), raw))
      .catch(() => "?");
    try {
      const real = await realpath(linkPath);
      return real === skillReal
        ? { state: "linked", target }
        : { state: "conflict", reason: "link", target };
    } catch (error) {
      return isMissing(error)
        ? { state: "broken", target }
        : { state: "conflict", reason: "error", target: message(error) };
    }
  }
  const real = await realpath(linkPath).catch(() => linkPath);
  if (real === skillReal) return { state: "source" };
  return { state: "conflict", reason: info.isDirectory() ? "directory" : "file" };
}

/** Returns the resolved target when `path` is a symlink whose target is missing. */
async function brokenTarget(path: string): Promise<string | null> {
  try {
    if (!(await lstat(path)).isSymbolicLink()) return null;
    await stat(path);
    return null;
  } catch (error) {
    if (!isMissing(error)) return null;
    return readlink(path)
      .then((raw) => resolve(dirname(path), raw))
      .catch(() => null);
  }
}

async function removeLink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    // Windows directory junctions are removed with rmdir; the target is untouched.
    const code = errorCode(error);
    if (process.platform === "win32" && (code === "EPERM" || code === "EISDIR")) await rmdir(path);
    else throw error;
  }
}

async function readPrefix(path: string, limit: number) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, limit + 1, 0);
    return {
      text: buffer.subarray(0, Math.min(bytesRead, limit)).toString("utf8"),
      truncated: bytesRead > limit,
    };
  } finally {
    await handle.close();
  }
}

async function mapLimit<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

async function readHeader(dir: string) {
  try {
    return parseSkillDoc((await readPrefix(join(dir, "SKILL.md"), MAX_HEADER)).text);
  } catch {
    return { body: "" };
  }
}

function cellError(cell: Cell): never {
  if (cell.state === "broken") fail("E_BROKEN");
  if (cell.state === "source") fail("E_SOURCE");
  if (cell.reason === "error" && cell.target) throw new Error(cell.target);
  fail("E_OCCUPIED");
}

function context(config: HubConfig, home: string) {
  const agents = resolveAgents(config.agents).map((agent) => ({
    ...agent,
    dir: expandPath(agent.path, home),
  }));
  const sources = config.sources.map((path) => ({ path, dir: expandPath(path, home) }));
  const roots = [...new Set(sources.flatMap((s) => (s.dir ? [s.dir] : [])))];
  return { agents, sources, roots };
}

/** Only directories under a configured source that still contain SKILL.md may be linked or read. */
async function checkSkill(input: string, roots: readonly string[]): Promise<string> {
  if (!isAbsolute(input)) fail("E_SKILL_PATH");
  const path = resolve(input);
  const real = await realpath(path).catch(() => null);
  if (!real || !(await isDirectory(real))) fail("E_SKILL_MISSING");
  // Compare canonical paths so symlinks inside a source cannot point the check elsewhere.
  const realRoots = await Promise.all(roots.map((root) => realpath(root).catch(() => null)));
  if (!realRoots.some((root) => root && within(real, root))) fail("E_OUTSIDE");
  const doc = await lstat(join(real, "SKILL.md")).catch(() => null);
  if (!doc?.isFile()) fail("E_NO_SKILL_MD");
  return path;
}

/** Sorts by name with each skill's nested skills right after it, setting their depth. */
function treeOrder(skills: Skill[]): Skill[] {
  const byName = (a: Skill, b: Skill) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path);
  const children = new Map<string | null, Skill[]>();
  for (const skill of skills) {
    const list = children.get(skill.parent) ?? [];
    list.push(skill);
    children.set(skill.parent, list);
  }
  const ordered: Skill[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const skill of (children.get(parent) ?? []).sort(byName)) {
      ordered.push({ ...skill, depth });
      visit(skill.path, depth + 1);
    }
  };
  visit(null, 0);
  return ordered;
}

export async function scan(config: HubConfig, home: string): Promise<ScanResult> {
  const { agents, sources, roots } = context(config, home);
  const { found, truncated } = await discover(roots);
  const active = agents.filter((agent) => agent.enabled && agent.dir);

  const nameCount = new Map<string, number>();
  for (const { dir } of found) nameCount.set(basename(dir), (nameCount.get(basename(dir)) ?? 0) + 1);

  const unordered: Skill[] = await mapLimit(found, async ({ root, dir, parent }) => {
    const doc = await readHeader(dir);
    const real = await realpath(dir).catch(() => dir);
    const dirName = basename(dir);
    const cells: Skill["cells"] = {};
    await Promise.all(
      active.map(async (agent) => {
        cells[agent.id] = await inspect(join(agent.dir!, dirName), real);
      }),
    );
    return {
      path: dir,
      dirName,
      name: doc.name || dirName,
      description: doc.description ?? "",
      source: root,
      parent,
      depth: 0,
      duplicate: (nameCount.get(dirName) ?? 0) > 1,
      cells,
    };
  });
  const skills = treeOrder(unordered);

  const broken: BrokenLink[] = [];
  const brokenSeen = new Set<string>();
  for (const agent of active) {
    let entries: Dirent[] = [];
    try {
      entries = await readdir(agent.dir!, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) continue;
      const path = join(agent.dir!, entry.name);
      if (brokenSeen.has(path)) continue;
      const target = await brokenTarget(path);
      if (target === null) continue;
      brokenSeen.add(path);
      broken.push({ agentId: agent.id, path, target });
    }
  }

  return {
    sources: await Promise.all(
      sources.map(async (source) => {
        const exists = await isDirectory(source.dir);
        return {
          path: source.path,
          dir: source.dir,
          exists,
          count: found.filter((f) => f.root === source.dir).length,
          gitBranch: exists ? await gitBranch(source.dir!, home) : null,
        };
      }),
    ),
    agents: await Promise.all(
      agents.map(async (agent) => ({
        id: agent.id,
        name: agent.name,
        path: agent.path,
        dir: agent.dir,
        exists: await isDirectory(agent.dir),
        enabled: agent.enabled,
        builtin: agent.builtin,
        defaultPath: agent.defaultPath,
      })),
    ),
    skills,
    broken,
    truncated,
  };
}

export async function apply(config: HubConfig, ops: readonly LinkOp[], home: string) {
  const { agents, roots } = context(config, home);
  const results: (LinkOp & { ok: boolean; error?: string })[] = [];
  for (const op of ops) {
    try {
      const agent = agents.find((a) => a.id === op.agentId && a.enabled);
      if (!agent) fail("E_AGENT");
      if (!agent.dir) fail("E_AGENT_PATH");
      const skill = await checkSkill(op.skill, roots);
      const link = join(agent.dir, basename(skill));
      const cell = await inspect(link, await realpath(skill));
      if (op.action === "deploy") {
        if (cell.state === "none") {
          await mkdir(agent.dir, { recursive: true });
          await symlink(skill, link, LINK_TYPE);
        } else if (cell.state !== "linked" && cell.state !== "source") {
          cellError(cell);
        }
      } else if (cell.state === "linked") {
        await removeLink(link);
      } else if (cell.state !== "none") {
        cellError(cell);
      }
      results.push({ ...op, ok: true });
    } catch (error) {
      results.push({ ...op, ok: false, error: message(error) });
    }
  }
  return { results };
}

/** Removes symlinks whose targets are gone, only directly inside enabled agent directories. */
export async function prune(config: HubConfig, paths: readonly string[], home: string) {
  const { agents } = context(config, home);
  const dirs = new Set(agents.flatMap((a) => (a.enabled && a.dir ? [a.dir] : [])));
  let removed = 0;
  const errors: { path: string; error: string }[] = [];
  for (const input of paths) {
    try {
      const path = resolve(input);
      if (!isAbsolute(input) || !dirs.has(dirname(path))) fail("E_NOT_AGENT_DIR");
      if ((await brokenTarget(path)) === null) fail("E_NOT_BROKEN");
      await removeLink(path);
      removed++;
    } catch (error) {
      errors.push({ path: input, error: message(error) });
    }
  }
  return { removed, errors };
}

export async function readSkill(config: HubConfig, input: string, home: string) {
  const path = await checkSkill(input, context(config, home).roots);
  const { text, truncated } = await readPrefix(join(path, "SKILL.md"), MAX_READ);
  return { body: parseSkillDoc(text).body, truncated };
}

/** Fast-forward pulls the requested configured sources that are git work trees. */
export async function pull(config: HubConfig, inputs: readonly string[], home: string) {
  const { sources } = context(config, home);
  const results: { source: string; ok: boolean; changed: boolean; message: string }[] = [];
  for (const input of inputs) {
    try {
      const source = sources.find((s) => s.path === input);
      if (!source?.dir || !(await isDirectory(source.dir))) fail("E_NOT_SOURCE");
      if ((await gitBranch(source.dir, home)) === null) fail("E_NOT_GIT");
      results.push({ source: input, ok: true, ...(await gitPull(source.dir)) });
    } catch (error) {
      results.push({ source: input, ok: false, changed: false, message: message(error) });
    }
  }
  return { results };
}
