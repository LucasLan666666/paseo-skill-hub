import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { HubConfig } from "../shared/config";
import { resolveAgents } from "../shared/config";
import { parseSkillDoc } from "../server/frontmatter";
import { apply, expandPath, prune, pull, readSkill, scan } from "../server/skills";
import { gitBranch } from "../server/git";
import { ERROR_CODES } from "../shared/contracts";
import { localizeError, type MessageKey, translator } from "../client/i18n";

let home: string;

async function skill(dir: string, header = "") {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `${header}# Title\n\nBody text.\n`);
}

function config(extra: Partial<HubConfig> = {}): HubConfig {
  return {
    sources: ["~/src"],
    agents: [
      { id: "claude", name: "Claude Code", path: "~/agents/claude", enabled: true },
      { id: "codex", name: "Codex", path: "~/agents/codex", enabled: true },
      ...["copilot", "opencode", "pi", "omp", "antigravity", "muse"].map((id) => ({
        id,
        name: id,
        path: `~/.${id}`,
        enabled: false,
      })),
    ],
    language: "system",
    ...extra,
  };
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), "skill-hub-"));
  await skill(join(home, "src/repo-a/alpha"), "---\nname: alpha-skill\ndescription: >\n  Folded\n  text\n---\n");
  await skill(join(home, "src/repo-a/beta"));
  await skill(join(home, "src/repo-b/nested/beta"));
  await skill(join(home, "src/.hidden/gamma"));
  await skill(join(home, "src/node_modules/delta"));
  await mkdir(join(home, "agents/claude"), { recursive: true });
});

after(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("frontmatter", () => {
  test("reads quoted, folded and plain values", () => {
    assert.deepEqual(
      parseSkillDoc('---\nname: "x"\ndescription: |\n  line one\n  line two\n---\n# H\n').description,
      "line one\nline two",
    );
    const doc = parseSkillDoc("---\nname: demo\ndescription: plain\n  continued\n---\nBody");
    assert.equal(doc.name, "demo");
    assert.equal(doc.description, "plain continued");
    assert.equal(doc.body, "Body");
  });

  test("falls back to the first paragraph", () => {
    assert.equal(parseSkillDoc("# Title\n\n```\ncode\n```\nFirst line\n").description, "First line");
  });
});

describe("paths and agents", () => {
  test("expands ~ and rejects relative paths", () => {
    assert.equal(expandPath("~/x/", "/home/u"), "/home/u/x");
    assert.equal(expandPath("~", "/home/u"), "/home/u");
    assert.equal(expandPath("rel/path", "/home/u"), null);
  });

  test("merges built-in overrides and custom agents", () => {
    const agents = resolveAgents([
      { id: "codex", name: "Codex", path: "~/custom", enabled: false },
      { id: "mine", name: "Mine", path: "~/mine", enabled: true },
    ]);
    const codex = agents.find((a) => a.id === "codex")!;
    assert.equal(codex.path, "~/custom");
    assert.equal(codex.enabled, false);
    assert.equal(codex.defaultPath, "~/.agents/skills");
    assert.equal(agents.find((a) => a.id === "claude")!.path, "~/.claude/skills");
    assert.equal(agents.at(-1)!.id, "mine");
  });
});

describe("scan and link", () => {
  test("discovers skills, skipping hidden and node_modules directories", async () => {
    const result = await scan(config(), home);
    assert.deepEqual(
      result.skills.map((s) => s.name),
      ["alpha-skill", "beta", "beta"],
    );
    assert.equal(result.skills[0].description, "Folded text");
    assert.ok(result.skills.filter((s) => s.dirName === "beta").every((s) => s.duplicate));
    assert.deepEqual(result.sources, [
      { path: "~/src", dir: join(home, "src"), exists: true, count: 3, gitBranch: null },
    ]);
    assert.deepEqual(Object.keys(result.skills[0].cells).sort(), ["claude", "codex"]);
    assert.ok(result.skills.every((s) => s.cells.claude.state === "none"));
  });

  test("deploys with a directory symlink and creates the agent dir", async () => {
    const alpha = join(home, "src/repo-a/alpha");
    const { results } = await apply(
      config(),
      [
        { action: "deploy", skill: alpha, agentId: "claude" },
        { action: "deploy", skill: alpha, agentId: "codex" },
      ],
      home,
    );
    assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    assert.equal(await readlink(join(home, "agents/codex/alpha")), alpha);
    const after = await scan(config(), home);
    const cells = after.skills.find((s) => s.path === alpha)!.cells;
    assert.equal(cells.claude.state, "linked");
    assert.equal(cells.codex.state, "linked");
  });

  test("recognizes existing relative symlinks", async () => {
    await symlink("../../src/repo-a/beta", join(home, "agents/claude/beta"));
    const result = await scan(config(), home);
    const [a, b] = result.skills.filter((s) => s.dirName === "beta");
    const states = [a, b].map((s) => (s.path.includes("repo-a") ? s : null)).filter(Boolean);
    assert.equal(states[0]!.cells.claude.state, "linked");
    const other = [a, b].find((s) => s.path.includes("repo-b"))!;
    assert.deepEqual(other.cells.claude, {
      state: "conflict",
      reason: "link",
      target: join(home, "src/repo-a/beta"),
    });
  });

  test("never overwrites an existing directory", async () => {
    await mkdir(join(home, "agents/codex/beta"));
    const beta = join(home, "src/repo-a/beta");
    const { results } = await apply(config(), [{ action: "deploy", skill: beta, agentId: "codex" }], home);
    assert.equal(results[0].error, "E_OCCUPIED");
    assert.ok((await lstat(join(home, "agents/codex/beta"))).isDirectory());
    const { results: undo } = await apply(config(), [{ action: "undeploy", skill: beta, agentId: "codex" }], home);
    assert.equal(undo[0].ok, false);
    assert.ok((await lstat(join(home, "agents/codex/beta"))).isDirectory());
  });

  test("undeploy removes only the link, not the source", async () => {
    const alpha = join(home, "src/repo-a/alpha");
    const { results } = await apply(config(), [{ action: "undeploy", skill: alpha, agentId: "codex" }], home);
    assert.ok(results[0].ok);
    await assert.rejects(lstat(join(home, "agents/codex/alpha")));
    assert.ok((await lstat(join(alpha, "SKILL.md"))).isFile());
  });

  test("rejects skills outside configured sources and disabled agents", async () => {
    await skill(join(home, "elsewhere/x"));
    const { results } = await apply(
      config(),
      [
        { action: "deploy", skill: join(home, "elsewhere/x"), agentId: "claude" },
        { action: "deploy", skill: join(home, "src/repo-a/alpha"), agentId: "pi" },
      ],
      home,
    );
    assert.deepEqual(results.map((r) => r.error), ["E_OUTSIDE", "E_AGENT"]);
    await assert.rejects(readSkill(config(), join(home, "elsewhere/x"), home));
  });

  test("does not follow symlinks out of a source", async () => {
    await skill(join(home, "outside/escape"));
    await symlink(join(home, "outside"), join(home, "src/linked-dir"));
    await mkdir(join(home, "src/linked-doc"));
    await symlink(join(home, "outside/escape/SKILL.md"), join(home, "src/linked-doc/SKILL.md"));
    const result = await scan(config(), home);
    assert.ok(!result.skills.some((s) => s.path.includes("linked-")));
    const escape = join(home, "src/linked-dir/escape");
    const { results } = await apply(config(), [{ action: "deploy", skill: escape, agentId: "claude" }], home);
    assert.equal(results[0].ok, false);
    await assert.rejects(readSkill(config(), escape, home));
    await assert.rejects(readSkill(config(), join(home, "src/linked-doc"), home));
  });

  test("reports broken links and prunes only those", async () => {
    await symlink(join(home, "src/gone"), join(home, "agents/claude/gone"));
    const result = await scan(config(), home);
    assert.deepEqual(result.broken, [
      { agentId: "claude", path: join(home, "agents/claude/gone"), target: join(home, "src/gone") },
    ]);
    const outcome = await prune(
      config(),
      [join(home, "agents/claude/gone"), join(home, "agents/claude/alpha"), join(home, "src/repo-a/beta")],
      home,
    );
    assert.equal(outcome.removed, 1);
    assert.deepEqual(outcome.errors.map((e) => e.error), ["E_NOT_BROKEN", "E_NOT_AGENT_DIR"]);
    assert.ok((await lstat(join(home, "agents/claude/alpha"))).isSymbolicLink());
    assert.ok((await lstat(join(home, "src/repo-a/beta"))).isDirectory());
  });

  test("marks a skill whose original lives in the agent dir as source", async () => {
    const cfg = config({ sources: ["~/src", "~/agents/claude"] });
    await skill(join(home, "agents/claude/native"));
    const result = await scan(cfg, home);
    const native = result.skills.find((s) => s.dirName === "native")!;
    assert.equal(native.cells.claude.state, "source");
    assert.ok(!result.skills.some((s) => s.path === join(home, "agents/claude/alpha")));
  });

  test("finds skills nested inside skills, ordered under their parent", async () => {
    await skill(join(home, "nest/top"));
    await skill(join(home, "nest/top/child-b"));
    await skill(join(home, "nest/top/group/child-a"));
    await skill(join(home, "nest/top/child-b/grandchild"));
    await skill(join(home, "nest/top/.hidden/ignored"));
    await skill(join(home, "nest/other"));
    const cfg = config({ sources: ["~/nest"] });
    const result = await scan(cfg, home);
    assert.deepEqual(
      result.skills.map((s) => [s.dirName, s.depth, s.parent && basename(s.parent)]),
      [
        ["other", 0, null],
        ["top", 0, null],
        ["child-a", 1, "top"],
        ["child-b", 1, "top"],
        ["grandchild", 2, "child-b"],
      ],
    );
    assert.equal(result.sources[0].count, 5);

    const child = join(home, "nest/top/child-b");
    const { results } = await apply(cfg, [{ action: "deploy", skill: child, agentId: "codex" }], home);
    assert.ok(results[0].ok, JSON.stringify(results));
    assert.equal(await readlink(join(home, "agents/codex/child-b")), child);
    const states = Object.fromEntries((await scan(cfg, home)).skills.map((s) => [s.dirName, s.cells.codex.state]));
    assert.deepEqual(states, { other: "none", top: "none", "child-a": "none", "child-b": "linked", grandchild: "none" });
  });

  test("reads the SKILL.md body without frontmatter", async () => {
    const doc = await readSkill(config(), join(home, "src/repo-a/alpha"), home);
    assert.equal(doc.body, "# Title\n\nBody text.\n");
  });
});

describe("git sources", () => {
  const sh = (cmd: string, cwd: string) => execSync(cmd, { cwd, stdio: "pipe" }).toString();

  test("detects work trees, ignores home-rooted repos, and fast-forward pulls", async () => {
    const origin = join(home, "git/origin.git");
    const writer = join(home, "git/writer");
    await mkdir(join(home, "git"), { recursive: true });
    sh(`git init -q --bare -b main ${origin}`, home);
    sh(`git clone -q ${origin} ${writer}`, home);
    await skill(join(writer, "skills/first"));
    sh("git add . && git -c user.email=t@t -c user.name=t commit -qm one && git push -q origin HEAD:main", writer);
    const clone = join(home, "git/clone");
    sh(`git clone -q ${origin} ${clone}`, home);

    const cfg = config({ sources: ["~/git/clone/skills", "~/src"] });
    const before = await scan(cfg, home);
    assert.equal(before.sources[0].gitBranch, "main");
    assert.equal(before.sources[1].gitBranch, null);
    assert.equal(await gitBranch(clone, clone), null);

    await skill(join(writer, "skills/second"));
    sh("git add . && git -c user.email=t@t -c user.name=t commit -qm two && git push -q origin HEAD:main", writer);
    const { results } = await pull(cfg, ["~/git/clone/skills", "~/src", "~/unknown"], home);
    assert.deepEqual(
      results.map((r) => [r.ok, r.changed, r.ok ? "" : r.message]),
      [[true, true, ""], [false, false, "E_NOT_GIT"], [false, false, "E_NOT_SOURCE"]],
    );
    const after = await scan(cfg, home);
    assert.ok(after.skills.some((s) => s.dirName === "second"));
  });
});

describe("i18n", () => {
  test("translates, interpolates and falls back", () => {
    const zh = translator("zh-CN");
    assert.equal(zh("skills.done", { count: 3 }), "已完成 3 项");
    assert.equal(translator("en")("skills.done", { count: 3 }), "Done: 3");
    assert.equal(localizeError(zh, new Error("E_OUTSIDE")), "Skill 不在已配置的来源目录中");
    assert.equal(localizeError(zh, "E_CONFIG: bad"), "Skill Hub 配置无效: bad");
    assert.equal(localizeError(zh, "EACCES: permission denied"), "EACCES: permission denied");
  });

  test("every server error code has a message", () => {
    const en = translator("en");
    for (const code of ERROR_CODES) assert.notEqual(en(`error.${code}` as MessageKey), `error.${code}`);
  });
});
