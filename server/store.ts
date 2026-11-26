import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep, win32 } from "node:path";
import { z } from "zod";
import { CONFIG_VERSION, type HubConfig, hubConfigSchema, migrateHubConfig } from "../shared/config";
import type { ConfigState, ConfigWriteResult } from "../shared/contracts";

const APP_DIR = "paseo-skill-hub";
const CONFIG_FILE = "config.json";
const envelopeSchema = z.object({
  version: z.number().int().positive(),
  values: z.unknown(),
});

export type LegacyConfigState =
  | { status: "ready"; revision: string; values: HubConfig }
  | { status: "invalid"; revision: string; error: string };

export interface ConfigStoreOptions {
  filePath: string;
  home: string;
  /** Optional one-time migration source from Paseo's managed plugin-settings directory. */
  readLegacy?: () => Promise<LegacyConfigState>;
}

export interface LocalConfigStore {
  readonly filePath: string;
  readonly displayPath: string;
  read(): Promise<ConfigState>;
  write(revision: string, values: unknown): Promise<ConfigWriteResult>;
  reset(revision: string): Promise<ConfigWriteResult>;
  subscribe(listener: (state: ConfigState) => void): () => void;
}

function revisionOf(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function formatError(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map((issue) => issue.message).join("\n");
  return error instanceof Error ? error.message : String(error);
}

function displayHomePath(filePath: string, home: string): string {
  if (!home) return filePath;
  const normalizedHome = resolve(home);
  const normalizedFile = resolve(filePath);
  if (normalizedFile === normalizedHome) return "~";
  const prefix = normalizedHome.endsWith(sep) ? normalizedHome : normalizedHome + sep;
  if (normalizedFile.startsWith(prefix)) {
    return `~/${normalizedFile.slice(prefix.length).replace(/\\/g, "/")}`;
  }
  return filePath;
}

/**
 * Resolves the persistent user-level config file path outside Paseo's managed plugin-settings
 * directory so configuration survives plugin uninstall and reinstall.
 */
export function defaultConfigPath(
  home: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "win32") {
    const appData = env.APPDATA?.trim();
    if (appData && win32.isAbsolute(appData)) {
      return win32.join(appData, APP_DIR, CONFIG_FILE);
    }
    return win32.join(home, ".config", APP_DIR, CONFIG_FILE);
  }
  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg && isAbsolute(xdg)) {
    return join(xdg, APP_DIR, CONFIG_FILE);
  }
  return join(home, ".config", APP_DIR, CONFIG_FILE);
}

/**
 * Persistent host-local config store backed by a pretty-printed JSON file with atomic writes,
 * serialized access, optimistic concurrency (`revision`), schema migration, and automatic
 * one-time import from Paseo's legacy `plugin-settings` store.
 */
export function createConfigStore(options: ConfigStoreOptions): LocalConfigStore {
  const { filePath, home, readLegacy } = options;
  const displayPath = displayHomePath(filePath, home);
  const listeners = new Set<(state: ConfigState) => void>();
  let queue: Promise<unknown> = Promise.resolve();
  let legacyChecked = false;

  function serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = queue.then(work);
    queue = pending.catch(() => undefined);
    return pending;
  }

  function notify(state: ConfigState) {
    for (const listener of listeners) {
      try {
        listener(structuredClone(state));
      } catch {
        // One failing subscriber must not break others or fail the write.
      }
    }
  }

  async function readRaw(): Promise<{ raw: string | null; revision: string }> {
    try {
      const raw = await readFile(filePath, "utf8");
      return { raw, revision: revisionOf(raw) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        return { raw: null, revision: "missing" };
      }
      throw error;
    }
  }

  async function persist(values: HubConfig): Promise<string> {
    await mkdir(dirname(filePath), { recursive: true });
    const raw = `${JSON.stringify({ version: CONFIG_VERSION, values }, null, 2)}\n`;
    const temp = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, raw, { mode: 0o600 });
      await rename(temp, filePath);
    } finally {
      await rm(temp, { force: true });
    }
    return revisionOf(raw);
  }

  async function readInternal(): Promise<ConfigState> {
    const stored = await readRaw();
    if (stored.raw === null) {
      // One-time migration from Paseo's managed plugin-settings when upgrading from 0.1.0.
      if (!legacyChecked && readLegacy) {
        legacyChecked = true;
        try {
          const legacy = await readLegacy();
          if (legacy.status === "ready" && legacy.revision !== "missing") {
            const parsed = hubConfigSchema.parse(legacy.values);
            const revision = await persist(parsed);
            const state: ConfigState = { status: "ready", revision, values: parsed, path: displayPath };
            notify(state);
            return state;
          }
        } catch {
          // Legacy migration is best-effort; fall back to defaults if unavailable.
        }
      }
      return {
        status: "ready",
        revision: "missing",
        values: hubConfigSchema.parse({}),
        path: displayPath,
      };
    }

    legacyChecked = true;
    try {
      const envelope = envelopeSchema.parse(JSON.parse(stored.raw));
      let values: unknown = envelope.values ?? {};
      if (envelope.version > CONFIG_VERSION) {
        throw new Error("Settings were saved by a newer plugin version");
      }
      const needsMigration = envelope.version !== CONFIG_VERSION;
      if (needsMigration) {
        values = migrateHubConfig(values);
      }
      const parsed = hubConfigSchema.parse(values);
      const revision = needsMigration ? await persist(parsed) : stored.revision;
      const state: ConfigState = { status: "ready", revision, values: parsed, path: displayPath };
      if (needsMigration) notify(state);
      return state;
    } catch (error) {
      return {
        status: "invalid",
        revision: stored.revision,
        error: formatError(error),
        path: displayPath,
      };
    }
  }

  async function writeInternal(
    revision: string,
    values: unknown,
    intent: "save" | "reset",
  ): Promise<ConfigWriteResult> {
    const stored = await readRaw();
    if (stored.revision !== revision) {
      return {
        status: "conflict",
        error: "Settings changed on another client. Reload before saving again.",
      };
    }
    let parsed: HubConfig;
    try {
      if (intent === "save" && stored.raw !== null) {
        const envelope = envelopeSchema.parse(JSON.parse(stored.raw));
        if (envelope.version !== CONFIG_VERSION) {
          throw new Error("Reload or reset settings before saving a different schema version");
        }
      }
      parsed = hubConfigSchema.parse(values);
    } catch (error) {
      return { status: "invalid", error: formatError(error) };
    }
    legacyChecked = true;
    const nextRevision = await persist(parsed);
    notify({ status: "ready", revision: nextRevision, values: parsed, path: displayPath });
    return { status: "saved", revision: nextRevision, values: parsed, path: displayPath };
  }

  return {
    filePath,
    displayPath,
    read: () => serial(readInternal),
    write: (revision, values) => serial(() => writeInternal(revision, values, "save")),
    reset: (revision) => serial(() => writeInternal(revision, {}, "reset")),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
