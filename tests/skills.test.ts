import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { HubConfig } from "../shared/config";
import { configSettings, DEFAULT_TARGETS } from "../shared/config";
import { parseSkillDoc } from "../server/frontmatter";
import { apply, expandPath, prune, pull, readSkill, scan } from "../server/skills";
import { gitInfo } from "../server/git";
import { createConfigStore, defaultConfigPath } from "../server/store";
import { readFile } from "node:fs/promises";
import { ERROR_CODES } from "../shared/contracts";
import { localizeError, type MessageKey, translator } from "../client/i18n";
import { targetLabel, tildify } from "../client/targets";
import { pullStatus, pullSummary } from "../client/pull";

let home: string;

async function skill(dir: string, header = "") {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `${header}# Title\n\nBody text.\n`);
}

function config(extra: Partial<HubConfig> = {}): HubConfig {
  return {
    sources: ["~/src"],
    targets: [
      { id: "claude", name: "Claude Code", path: "~/agents/claude" },
      { id: "codex", name: "", path: "~/agents/codex" },
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

describe("paths and targets", () => {
  test("expands ~ and rejects relative paths", () => {
    assert.equal(expandPath("~/x/", "/home/u"), "/home/u/x");
    assert.equal(expandPath("~", "/home/u"), "/home/u");
    assert.equal(expandPath("rel/path", "/home/u"), null);
  });

  test("defaults to the shared and Claude directories and migrates version 1", () => {
    assert.deepEqual(configSettings.schema.parse({}).targets, DEFAULT_TARGETS);
    const migrated = configSettings.schema.parse(
      configSettings.migrate!(
        {
          sources: ["~/x"],
          language: "en",
          agents: [
            { id: "codex", name: "Codex", path: "~/.agents/skills", enabled: true },
            { id: "custom-1", name: "Mine", path: "~/mine", enabled: true },
            { id: "custom-2", name: "Off", path: "~/off", enabled: false },
          ],
        },
        1,
      ),
    );
    assert.deepEqual(migrated, {
      sources: ["~/x"],
      language: "en",
      targets: [
        ...DEFAULT_TARGETS,
        { id: "copilot", name: "", path: "~/.copilot/skills" },
        { id: "opencode", name: "", path: "~/.config/opencode/skills" },
        { id: "pi", name: "", path: "~/.pi/agent/skills" },
        { id: "omp", name: "", path: "~/.omp/agent/skills" },
        { id: "antigravity", name: "", path: "~/.gemini/config/skills" },
        { id: "muse", name: "", path: "~/.config/muse/skills" },
        { id: "custom-1", name: "Mine", path: "~/mine" },
      ],
    });
  });

  test("shows paths under home with a tilde", () => {
    assert.equal(tildify("/home/u/skills/x", "/home/u"), "~/skills/x");
    assert.equal(tildify("/home/u", "/home/u"), "~");
    assert.equal(tildify("/home/user2/x", "/home/u"), "/home/user2/x");
  });

  test("labels targets by name, known directory, or folder", () => {
    const zh = translator("zh-CN");
    assert.equal(targetLabel(zh, { name: "", path: "~/.agents/skills/" }), "通用");
    assert.equal(targetLabel(zh, { name: "", path: "~/.claude/skills" }), "Claude Code");
    assert.equal(targetLabel(zh, { name: "", path: "~/.foo/skills" }), ".foo");
    assert.equal(targetLabel(zh, { name: "Mine", path: "~/.foo/skills" }), "Mine");
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
      { path: "~/src", dir: join(home, "src"), exists: true, count: 3, gitRoot: null, gitBranch: null },
    ]);
    assert.deepEqual(Object.keys(result.skills[0].cells).sort(), ["claude", "codex"]);
    assert.ok(result.skills.every((s) => s.cells.claude.state === "none"));
  });

  test("deploys with a directory symlink and creates the agent dir", async () => {
    const alpha = join(home, "src/repo-a/alpha");
    const { results } = await apply(
      config(),
      [
        { action: "deploy", skill: alpha, targetId: "claude" },
        { action: "deploy", skill: alpha, targetId: "codex" },
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
    const { results } = await apply(config(), [{ action: "deploy", skill: beta, targetId: "codex" }], home);
    assert.equal(results[0].error, "E_OCCUPIED");
    assert.ok((await lstat(join(home, "agents/codex/beta"))).isDirectory());
    const { results: undo } = await apply(config(), [{ action: "undeploy", skill: beta, targetId: "codex" }], home);
    assert.equal(undo[0].ok, false);
    assert.ok((await lstat(join(home, "agents/codex/beta"))).isDirectory());
  });

  test("undeploy removes only the link, not the source", async () => {
    const alpha = join(home, "src/repo-a/alpha");
    const { results } = await apply(config(), [{ action: "undeploy", skill: alpha, targetId: "codex" }], home);
    assert.ok(results[0].ok);
    await assert.rejects(lstat(join(home, "agents/codex/alpha")));
    assert.ok((await lstat(join(alpha, "SKILL.md"))).isFile());
  });

  test("rejects skills outside configured sources and unknown targets", async () => {
    await skill(join(home, "elsewhere/x"));
    const { results } = await apply(
      config(),
      [
        { action: "deploy", skill: join(home, "elsewhere/x"), targetId: "claude" },
        { action: "deploy", skill: join(home, "src/repo-a/alpha"), targetId: "pi" },
      ],
      home,
    );
    assert.deepEqual(results.map((r) => r.error), ["E_OUTSIDE", "E_TARGET"]);
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
    const { results } = await apply(config(), [{ action: "deploy", skill: escape, targetId: "claude" }], home);
    assert.equal(results[0].ok, false);
    await assert.rejects(readSkill(config(), escape, home));
    await assert.rejects(readSkill(config(), join(home, "src/linked-doc"), home));
  });

  test("reports broken links and prunes only those", async () => {
    await symlink(join(home, "src/gone"), join(home, "agents/claude/gone"));
    const result = await scan(config(), home);
    assert.deepEqual(result.broken, [
      { targetId: "claude", path: join(home, "agents/claude/gone"), target: join(home, "src/gone") },
    ]);
    const outcome = await prune(
      config(),
      [join(home, "agents/claude/gone"), join(home, "agents/claude/alpha"), join(home, "src/repo-a/beta")],
      home,
    );
    assert.equal(outcome.removed, 1);
    assert.deepEqual(outcome.errors.map((e) => e.error), ["E_NOT_BROKEN", "E_NOT_TARGET_DIR"]);
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
    const { results } = await apply(cfg, [{ action: "deploy", skill: child, targetId: "codex" }], home);
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
    assert.equal(before.sources[0].gitRoot, clone);
    assert.equal(before.sources[1].gitRoot, null);
    assert.equal(await gitInfo(clone, clone), null);

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

  test("preserves core.sshCommand and refuses to rebase diverged branches", async () => {
    const origin = join(home, "git/rebase-origin.git");
    const writer = join(home, "git/rebase-writer");
    const clone = join(home, "git/rebase-clone");
    sh(`git init -q --bare -b main ${origin}`, home);
    sh(`git clone -q ${origin} ${writer}`, home);
    await skill(join(writer, "skills/base"));
    sh("git add . && git -c user.email=t@t -c user.name=t commit -qm base && git push -q origin HEAD:main", writer);
    sh(`git clone -q ${origin} ${clone}`, home);

    // Local + upstream commits diverge while pull.rebase=true: pull must still fail without rebasing.
    await skill(join(clone, "skills/local-only"));
    sh("git add . && git -c user.email=t@t -c user.name=t commit -qm local", clone);
    sh("git config pull.rebase true", clone);
    const beforeHead = sh("git rev-parse HEAD", clone).trim();
    await skill(join(writer, "skills/remote-only"));
    sh("git add . && git -c user.email=t@t -c user.name=t commit -qm remote && git push -q origin HEAD:main", writer);

    const cfg = config({ sources: ["~/git/rebase-clone/skills"] });
    const { results } = await pull(cfg, ["~/git/rebase-clone/skills"], home);
    assert.equal(results[0].ok, false);
    assert.equal(sh("git rev-parse HEAD", clone).trim(), beforeHead);

    // Custom core.sshCommand must not be clobbered by a default GIT_SSH_COMMAND.
    const sshRepo = join(home, "git/ssh-repo");
    const marker = join(home, "git/ssh-marker");
    await mkdir(sshRepo, { recursive: true });
    sh("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", sshRepo);
    sh("git remote add origin git@example.invalid:org/repo.git", sshRepo);
    sh("git config branch.main.remote origin && git config branch.main.merge refs/heads/main", sshRepo);
    sh(`git config core.sshCommand 'sh -c "touch ${marker}; exit 1"'`, sshRepo);
    const sshCfg = config({ sources: ["~/git/ssh-repo"] });
    const sshRes = await pull(sshCfg, ["~/git/ssh-repo"], home);
    assert.equal(sshRes.results[0].ok, false);
    assert.ok((await lstat(marker)).isFile());
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

describe("pull feedback", () => {
  const zh = translator("zh-CN");
  const ok = (source: string, changed: boolean) => ({ source, ok: true, changed, message: "" });

  test("summarizes a pull-all", () => {
    assert.deepEqual(pullSummary(zh, [ok("~/a", true), ok("~/b", false)]), { error: false, text: "已更新 1 个仓库" });
    assert.deepEqual(pullSummary(zh, [ok("~/a", false)]), { error: false, text: "已是最新" });
    assert.deepEqual(
      pullSummary(zh, [ok("~/a", true), { source: "~/b", ok: false, changed: false, message: "E_NOT_GIT" }]),
      { error: true, text: "1 个仓库拉取失败。~/b：不是 Git 仓库" },
    );
  });

  test("describes one row", () => {
    assert.equal(pullStatus(zh, true, undefined), "拉取中…");
    assert.equal(pullStatus(zh, false, ok("~/a", true)), "已更新");
    assert.equal(pullStatus(zh, false, ok("~/a", false)), "已是最新");
    assert.equal(pullStatus(zh, false, { source: "~/a", ok: false, changed: false, message: "x" }), null);
  });
});

describe("persistent config store", () => {
  test("resolves a config path outside Paseo's plugin-settings directory", () => {
    assert.equal(defaultConfigPath("/home/u", "linux", {}), "/home/u/.config/paseo-skill-hub/config.json");
    assert.equal(
      defaultConfigPath("/home/u", "linux", { XDG_CONFIG_HOME: "/xdg" }),
      "/xdg/paseo-skill-hub/config.json",
    );
    assert.equal(
      defaultConfigPath("/home/u", "linux", { XDG_CONFIG_HOME: "relative" }),
      "/home/u/.config/paseo-skill-hub/config.json",
    );
    assert.equal(
      defaultConfigPath("C:\\Users\\u", "win32", { APPDATA: "C:\\Users\\u\\AppData\\Roaming" }),
      "C:\\Users\\u\\AppData\\Roaming\\paseo-skill-hub\\config.json",
    );
  });

  test("saves, survives a new store instance, and rejects stale revisions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skill-hub-store-"));
    const filePath = join(dir, "cfg/config.json");
    const store = createConfigStore({ filePath, home: dir });
    const initial = await store.read();
    assert.equal(initial.status, "ready");
    assert.equal(initial.revision, "missing");
    assert.equal(initial.path, "~/cfg/config.json");

    const events: string[] = [];
    const off = store.subscribe((state) => events.push(state.revision));
    const values = { sources: ["~/skills"], targets: DEFAULT_TARGETS, language: "zh-CN" as const };
    const saved = await store.write("missing", values);
    assert.equal(saved.status, "saved");
    off();
    assert.equal(events.length, 1);
    assert.equal(JSON.parse(await readFile(filePath, "utf8")).version, 2);

    // A fresh store (as after uninstall + reinstall) reads the same values back.
    const again = await createConfigStore({ filePath, home: dir }).read();
    assert.equal(again.status, "ready");
    assert.deepEqual(again.status === "ready" && again.values, values);

    assert.equal((await store.write("missing", values)).status, "conflict");
    assert.equal((await store.write(again.revision, { sources: "nope" })).status, "invalid");

    const reset = await store.reset(again.revision);
    assert.equal(reset.status, "saved");
    assert.deepEqual(reset.status === "saved" && reset.values.targets, DEFAULT_TARGETS);
    await rm(dir, { recursive: true, force: true });
  });

  test("imports legacy Paseo settings once and migrates version 1 files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skill-hub-store-"));
    const legacyValues = { sources: ["~/legacy"], targets: DEFAULT_TARGETS, language: "en" as const };
    let legacyReads = 0;
    const filePath = join(dir, "config.json");
    const store = createConfigStore({
      filePath,
      home: dir,
      readLegacy: async () => {
        legacyReads++;
        return { status: "ready", revision: "abc", values: legacyValues };
      },
    });
    const state = await store.read();
    assert.deepEqual(state.status === "ready" && state.values, legacyValues);
    await store.read();
    assert.equal(legacyReads, 1);
    assert.ok(JSON.parse(await readFile(filePath, "utf8")).values.sources.includes("~/legacy"));

    // Absent legacy settings leave the file uncreated.
    const emptyPath = join(dir, "empty/config.json");
    const empty = createConfigStore({
      filePath: emptyPath,
      home: dir,
      readLegacy: async () => ({ status: "ready", revision: "missing", values: legacyValues }),
    });
    assert.equal((await empty.read()).revision, "missing");
    await assert.rejects(readFile(emptyPath, "utf8"));

    // A version 1 file is migrated in place.
    const v1Path = join(dir, "v1/config.json");
    await mkdir(join(dir, "v1"));
    await writeFile(v1Path, JSON.stringify({ version: 1, values: { sources: ["~/x"], agents: [] } }));
    const v1 = await createConfigStore({ filePath: v1Path, home: dir }).read();
    assert.equal(v1.status, "ready");
    assert.equal(JSON.parse(await readFile(v1Path, "utf8")).version, 2);

    // Corrupt files are reported, not overwritten.
    await writeFile(v1Path, "{ not json");
    assert.equal((await createConfigStore({ filePath: v1Path, home: dir }).read()).status, "invalid");
    await rm(dir, { recursive: true, force: true });
  });
});
