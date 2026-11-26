import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

const targetSchema = z.object({
  id: z.string().min(1),
  /** Optional display name; known directories get a built-in label when empty. */
  name: z.string().default(""),
  path: z.string(),
});
export type Target = z.infer<typeof targetSchema>;

/**
 * Most agents read the shared `~/.agents/skills`; Claude Code reads only `~/.claude/skills`.
 * Two targets therefore cover Claude Code, Codex, Pi, Oh My Pi and Antigravity.
 */
export const DEFAULT_TARGETS: Target[] = [
  { id: "shared", name: "", path: "~/.agents/skills" },
  { id: "claude", name: "", path: "~/.claude/skills" },
];

/** Built-in agents of settings version 1 and their default directories. */
const V1_AGENT_DIRS: Record<string, string> = {
  claude: "~/.claude/skills",
  codex: "~/.agents/skills",
  copilot: "~/.copilot/skills",
  opencode: "~/.config/opencode/skills",
  pi: "~/.pi/agent/skills",
  omp: "~/.omp/agent/skills",
  antigravity: "~/.gemini/config/skills",
  muse: "~/.config/muse/skills",
};

/**
 * Host-scoped document: every daemon keeps its own sources and target directories.
 */
export const configSettings = defineSettings({
  id: "config",
  scope: "host",
  version: 2,
  schema: z.object({
    sources: z.array(z.string()).default([]),
    targets: z.array(targetSchema).default(DEFAULT_TARGETS),
    language: z.enum(["system", "en", "zh-CN"]).default("system"),
  }),
  // Version 1 listed agents. Every directory that was visible in its matrix becomes a target, so
  // links already deployed there stay visible; agents that were switched off are dropped.
  migrate(values) {
    const old = (values ?? {}) as {
      sources?: unknown;
      language?: unknown;
      agents?: { id?: string; name?: string; path?: string; enabled?: boolean }[];
    };
    const stored = old.agents ?? [];
    const visible: Target[] = [];
    for (const [id, path] of Object.entries(V1_AGENT_DIRS)) {
      const entry = stored.find((a) => a.id === id);
      if (entry?.enabled !== false) visible.push({ id, name: "", path: entry?.path?.trim() || path });
    }
    for (const a of stored) {
      if (a.id && !(a.id in V1_AGENT_DIRS) && a.path && a.enabled !== false) {
        visible.push({ id: a.id, name: a.name ?? "", path: a.path });
      }
    }
    const targets = [...DEFAULT_TARGETS];
    for (const target of visible) if (!targets.some((t) => t.path === target.path)) targets.push(target);
    return { sources: old.sources, language: old.language, targets };
  },
});

export type HubConfig = z.infer<typeof configSettings.schema>;
export type LanguageChoice = HubConfig["language"];

/**
 * User-level skills directories and the agents known to read them, checked against each agent's
 * code. `name` is empty for the shared directory, whose label is translated by the client.
 */
export const KNOWN_DIRS: readonly { path: string; name: string; readers: string }[] = [
  { path: "~/.agents/skills", name: "", readers: "Codex, Pi, Oh My Pi, Antigravity" },
  { path: "~/.claude/skills", name: "Claude Code", readers: "Claude Code" },
  { path: "~/.config/opencode/skills", name: "OpenCode", readers: "OpenCode" },
  { path: "~/.copilot/skills", name: "Copilot", readers: "Copilot" },
  { path: "~/.omp/agent/skills", name: "Oh My Pi", readers: "Oh My Pi" },
  { path: "~/.pi/agent/skills", name: "Pi", readers: "Pi" },
  { path: "~/.gemini/config/skills", name: "Antigravity", readers: "Antigravity" },
];

export function knownDir(path: string) {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  return KNOWN_DIRS.find((dir) => dir.path === normalized);
}

/** Accepts `~`, `~/…`, POSIX absolute and Windows absolute paths. */
export function looksAbsolute(path: string): boolean {
  return /^(~([\\/]|$)|\/|[A-Za-z]:[\\/]|\\\\)/.test(path.trim());
}
