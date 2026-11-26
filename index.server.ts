import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { apply, prune, pull, readSkill, scan } from "./server/skills";
import { configSettings, type HubConfig } from "./shared/config";
import { applyRpc, pruneRpc, pullRpc, readSkillRpc, scanRpc } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(configSettings);
  const home = homedir();

  async function config(): Promise<HubConfig> {
    const state = await settings.read();
    if (state.status !== "ready") throw new Error(`E_CONFIG: ${state.error}`);
    return state.values;
  }

  server.handle(scanRpc, async () => scan(await config(), home));
  server.handle(applyRpc, async ({ ops }) => apply(await config(), ops, home));
  server.handle(pruneRpc, async ({ paths }) => prune(await config(), paths, home));
  server.handle(readSkillRpc, async ({ path }) => readSkill(await config(), path, home));
  server.handle(pullRpc, async ({ sources }) => pull(await config(), sources, home));
  return () => {};
}
