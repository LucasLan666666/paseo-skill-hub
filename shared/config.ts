import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

const agentEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string(),
  enabled: z.boolean().default(true),
});

/**
 * Host-scoped document: every daemon keeps its own sources and agents.
 * `agents` holds overrides for built-in agents (matched by id) plus custom agents.
 */
export const configSettings = defineSettings({
  id: "config",
  scope: "host",
  version: 1,
  schema: z.object({
    sources: z.array(z.string()).default([]),
    agents: z.array(agentEntrySchema).default([]),
    language: z.enum(["system", "en", "zh-CN"]).default("system"),
  }),
});

export type AgentEntry = z.infer<typeof agentEntrySchema>;
export type HubConfig = z.infer<typeof configSettings.schema>;
export type LanguageChoice = HubConfig["language"];

/** User-level skills directories of the agents Paseo ships providers for. */
export const BUILTIN_AGENTS: readonly { id: string; name: string; short: string; path: string }[] = [
  { id: "claude", name: "Claude Code", short: "Claude", path: "~/.claude/skills" },
  { id: "codex", name: "Codex", short: "Codex", path: "~/.agents/skills" },
  { id: "copilot", name: "Copilot", short: "Copilot", path: "~/.copilot/skills" },
  { id: "opencode", name: "OpenCode", short: "OpenCode", path: "~/.config/opencode/skills" },
  { id: "pi", name: "Pi", short: "Pi", path: "~/.pi/agent/skills" },
  { id: "omp", name: "Oh My Pi", short: "OMP", path: "~/.omp/agent/skills" },
  { id: "antigravity", name: "Antigravity", short: "Agy", path: "~/.gemini/config/skills" },
  { id: "muse", name: "Muse Code", short: "Muse", path: "~/.config/muse/skills" },
];

/** Compact column label for the matrix header. */
export function shortName(agent: { id: string; name: string }): string {
  return BUILTIN_AGENTS.find((b) => b.id === agent.id)?.short ?? agent.name;
}

export interface ResolvedAgent {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  builtin: boolean;
  /** Built-in default path; absent for custom agents. */
  defaultPath?: string;
}

export function resolveAgents(stored: readonly AgentEntry[]): ResolvedAgent[] {
  const byId = new Map(stored.map((entry) => [entry.id, entry]));
  const builtins = BUILTIN_AGENTS.map((agent) => {
    const override = byId.get(agent.id);
    return {
      id: agent.id,
      name: agent.name,
      path: override?.path.trim() || agent.path,
      enabled: override?.enabled ?? true,
      builtin: true,
      defaultPath: agent.path,
    };
  });
  const custom = stored
    .filter((entry) => !BUILTIN_AGENTS.some((agent) => agent.id === entry.id))
    .map((entry) => ({ ...entry, builtin: false }));
  return [...builtins, ...custom];
}

/** Accepts `~`, `~/…`, POSIX absolute and Windows absolute paths. */
export function looksAbsolute(path: string): boolean {
  return /^(~([\\/]|$)|\/|[A-Za-z]:[\\/]|\\\\)/.test(path.trim());
}
