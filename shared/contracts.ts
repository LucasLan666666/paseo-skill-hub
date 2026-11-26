import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";
import { hubConfigSchema } from "./config";

/**
 * Deployment state of one skill in one target directory, read from the file system:
 * - linked: `<target dir>/<skill dir name>` is a symlink to this skill
 * - none: nothing exists at that path
 * - conflict: a directory, file, or link to somewhere else occupies the path
 * - broken: a symlink whose target no longer exists occupies the path
 * - source: the path is the skill itself (the target dir contains the original)
 */
export const cellStateSchema = z.enum(["linked", "none", "conflict", "broken", "source"]);
export type CellState = z.infer<typeof cellStateSchema>;

const cellSchema = z.object({
  state: cellStateSchema,
  /** What occupies the path for a conflict. */
  reason: z.enum(["directory", "file", "link", "error"]).optional(),
  /** Link target (linked, broken, link conflict) or raw error text. */
  target: z.string().optional(),
});
export type Cell = z.infer<typeof cellSchema>;

const skillSchema = z.object({
  /** Absolute skill directory; also the skill's identity. */
  path: z.string(),
  /** Directory name, used as the link name inside target directories. */
  dirName: z.string(),
  name: z.string(),
  description: z.string(),
  /** Expanded source root that contains the skill. */
  source: z.string(),
  /** Path of the nearest enclosing skill when this one is nested inside it. */
  parent: z.string().nullable(),
  /** Nesting level; 0 for top-level skills. Skills arrive ordered with children after parents. */
  depth: z.number(),
  /** Another discovered skill uses the same directory name. */
  duplicate: z.boolean(),
  /** Keyed by target id. */
  cells: z.record(z.string(), cellSchema),
});
export type Skill = z.infer<typeof skillSchema>;

const targetStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  /** Expanded absolute path; null when the configured path is not absolute. */
  dir: z.string().nullable(),
  exists: z.boolean(),
});
export type TargetStatus = z.infer<typeof targetStatusSchema>;

const sourceStatusSchema = z.object({
  path: z.string(),
  dir: z.string().nullable(),
  exists: z.boolean(),
  count: z.number(),
  /** Root of the git work tree containing the source; null when it is not in one. */
  gitRoot: z.string().nullable(),
  /** Current branch of that work tree; null when the source is not in one. */
  gitBranch: z.string().nullable(),
});
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

const brokenLinkSchema = z.object({
  targetId: z.string(),
  path: z.string(),
  target: z.string(),
});
export type BrokenLink = z.infer<typeof brokenLinkSchema>;

const scanResultSchema = z.object({
  sources: z.array(sourceStatusSchema),
  targets: z.array(targetStatusSchema),
  skills: z.array(skillSchema),
  broken: z.array(brokenLinkSchema),
  truncated: z.boolean(),
  /** The daemon user's home directory, used to show paths as `~/…`. */
  home: z.string(),
});
export type ScanResult = z.infer<typeof scanResultSchema>;

export const configStateSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    revision: z.string(),
    values: hubConfigSchema,
    /** Local file path on the daemon host where settings persist across reinstalls. */
    path: z.string(),
  }),
  z.object({
    status: z.literal("invalid"),
    revision: z.string(),
    error: z.string(),
    path: z.string(),
  }),
]);
export type ConfigState = z.infer<typeof configStateSchema>;

export const configWriteResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("saved"),
    revision: z.string(),
    values: hubConfigSchema,
    path: z.string(),
  }),
  z.object({
    status: z.literal("conflict"),
    error: z.string(),
  }),
  z.object({
    status: z.literal("invalid"),
    error: z.string(),
  }),
]);
export type ConfigWriteResult = z.infer<typeof configWriteResultSchema>;

export const readConfigRpc = defineRpc({
  name: "hub.config.read",
  input: z.object({}),
  output: configStateSchema,
});

export const writeConfigRpc = defineRpc({
  name: "hub.config.write",
  input: z.object({
    revision: z.string(),
    values: hubConfigSchema,
  }),
  output: configWriteResultSchema,
});

export const resetConfigRpc = defineRpc({
  name: "hub.config.reset",
  input: z.object({
    revision: z.string(),
  }),
  output: configWriteResultSchema,
});

export const watchConfigSub = defineSubscription({
  name: "hub.config.watch",
  input: z.object({}),
  event: configStateSchema,
});

export const scanRpc = defineRpc({
  name: "hub.scan",
  input: z.object({}),
  output: scanResultSchema,
});

const opSchema = z.object({
  action: z.enum(["deploy", "undeploy"]),
  skill: z.string(),
  targetId: z.string(),
});
export type LinkOp = z.infer<typeof opSchema>;

/** Largest list one apply/prune request accepts; the client sends bigger batches in chunks. */
export const MAX_BATCH = 1000;

/**
 * Errors the server reports are either one of these codes (translated by the client)
 * or raw text from the file system or git, which is shown unchanged.
 */
export const ERROR_CODES = [
  "E_CONFIG",
  "E_TARGET",
  "E_TARGET_PATH",
  "E_SKILL_PATH",
  "E_SKILL_MISSING",
  "E_OUTSIDE",
  "E_NO_SKILL_MD",
  "E_OCCUPIED",
  "E_BROKEN",
  "E_SOURCE",
  "E_NOT_TARGET_DIR",
  "E_NOT_BROKEN",
  "E_NOT_SOURCE",
  "E_NOT_GIT",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const applyRpc = defineRpc({
  name: "hub.apply",
  input: z.object({ ops: z.array(opSchema).max(MAX_BATCH) }),
  output: z.object({
    results: z.array(opSchema.extend({ ok: z.boolean(), error: z.string().optional() })),
  }),
});

export const pruneRpc = defineRpc({
  name: "hub.prune",
  input: z.object({ paths: z.array(z.string()).max(MAX_BATCH) }),
  output: z.object({
    removed: z.number(),
    errors: z.array(z.object({ path: z.string(), error: z.string() })),
  }),
});

export const readSkillRpc = defineRpc({
  name: "hub.read",
  input: z.object({ path: z.string() }),
  output: z.object({ body: z.string(), truncated: z.boolean() }),
});

export const pullRpc = defineRpc({
  name: "hub.pull",
  /** Source paths exactly as stored in settings. */
  input: z.object({ sources: z.array(z.string()).max(100) }),
  output: z.object({
    results: z.array(
      z.object({
        source: z.string(),
        ok: z.boolean(),
        changed: z.boolean(),
        /** Last line of git output on success, or the error. */
        message: z.string(),
      }),
    ),
  }),
});
