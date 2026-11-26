import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { apply, prune, pull, readSkill, scan } from "./server/skills";
import { createConfigStore, defaultConfigPath } from "./server/store";
import { configSettings, type HubConfig } from "./shared/config";
import {
  applyRpc,
  pruneRpc,
  pullRpc,
  readConfigRpc,
  readSkillRpc,
  resetConfigRpc,
  scanRpc,
  watchConfigSub,
  writeConfigRpc,
} from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  const legacySettings = server.registerSettings(configSettings);
  const home = homedir();
  const store = createConfigStore({
    filePath: defaultConfigPath(home),
    home,
    readLegacy: () => legacySettings.read(),
  });

  // Migrate any existing Paseo-managed settings into the persistent local file on startup.
  void store.read().catch(() => {});

  async function config(): Promise<HubConfig> {
    const state = await store.read();
    if (state.status !== "ready") throw new Error(`E_CONFIG: ${state.error}`);
    return state.values;
  }

  server.handle(readConfigRpc, () => store.read());
  server.handle(writeConfigRpc, ({ revision, values }) => store.write(revision, values));
  server.handle(resetConfigRpc, ({ revision }) => store.reset(revision));
  server.handle(watchConfigSub, (_input, { push, signal }) => {
    const unsubscribe = store.subscribe((state) => {
      void push(state);
    });
    signal.addEventListener("abort", unsubscribe, { once: true });
  });

  server.handle(scanRpc, async () => scan(await config(), home));
  server.handle(applyRpc, async ({ ops }) => apply(await config(), ops, home));
  server.handle(pruneRpc, async ({ paths }) => prune(await config(), paths, home));
  server.handle(readSkillRpc, async ({ path }) => readSkill(await config(), path, home));
  server.handle(pullRpc, async ({ sources }) => pull(await config(), sources, home));
  return () => {};
}
