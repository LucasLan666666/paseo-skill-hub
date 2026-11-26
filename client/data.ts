import { useRpc, useSubscription } from "@getpaseo/plugin/client";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { HubConfig } from "../shared/config";
import {
  type ConfigState,
  readConfigRpc,
  resetConfigRpc,
  scanRpc,
  watchConfigSub,
  writeConfigRpc,
} from "../shared/contracts";

export const CONFIG_KEY = ["skill-hub", "config"] as const;
export const SCAN_KEY = ["skill-hub", "scan"] as const;

export type HubConfigHandle =
  | { status: "loading"; reload(): Promise<void> }
  | { status: "error"; error: string; reload(): Promise<void> }
  | {
      status: "invalid";
      revision: string;
      error: string;
      path: string;
      saving: boolean;
      reset(): Promise<boolean>;
      reload(): Promise<void>;
    }
  | {
      status: "ready";
      revision: string;
      values: HubConfig;
      path: string;
      saving: boolean;
      save(values: HubConfig, revision: string): Promise<boolean>;
      reset(): Promise<boolean>;
      reload(): Promise<void>;
    };

/** Subscribes once per mounted Skill Hub surface so config changes sync across clients. */
export function useConfigSync() {
  const queryClient = useQueryClient();
  useSubscription(watchConfigSub, {}, (next) => {
    queryClient.setQueryData<ConfigState>(CONFIG_KEY, next);
  });
}

/** Reads and mutates Skill Hub's persistent host-local config file via plugin RPCs. */
export function useConfig(): HubConfigHandle {
  const queryClient = useQueryClient();
  const readConfig = useRpc(readConfigRpc);
  const writeConfig = useRpc(writeConfigRpc);
  const resetConfig = useRpc(resetConfigRpc);
  const [saving, setSaving] = useState(false);

  const query = useQuery({
    queryKey: CONFIG_KEY,
    queryFn: () => readConfig({}),
  });

  const reload = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
  }, [queryClient]);

  const data = query.data;

  const save = useCallback(
    async (values: HubConfig, revision: string): Promise<boolean> => {
      setSaving(true);
      try {
        const result = await writeConfig({ revision, values });
        if (result.status !== "saved") return false;
        const next: ConfigState = {
          status: "ready",
          revision: result.revision,
          values: result.values,
          path: result.path,
        };
        queryClient.setQueryData(CONFIG_KEY, next);
        return true;
      } catch {
        return false;
      } finally {
        setSaving(false);
      }
    },
    [queryClient, writeConfig],
  );

  const reset = useCallback(async (): Promise<boolean> => {
    if (!data) return false;
    setSaving(true);
    try {
      const result = await resetConfig({ revision: data.revision });
      if (result.status !== "saved") return false;
      const next: ConfigState = {
        status: "ready",
        revision: result.revision,
        values: result.values,
        path: result.path,
      };
      queryClient.setQueryData(CONFIG_KEY, next);
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, [data, queryClient, resetConfig]);

  if (query.isPending && !data) return { status: "loading", reload };
  if (query.isError && !data) {
    const message = query.error instanceof Error ? query.error.message : String(query.error);
    return { status: "error", error: message, reload };
  }
  if (!data) return { status: "loading", reload };
  if (data.status === "invalid") {
    return {
      status: "invalid",
      revision: data.revision,
      error: data.error,
      path: data.path,
      saving,
      reset,
      reload,
    };
  }
  return {
    status: "ready",
    revision: data.revision,
    values: data.values,
    path: data.path,
    saving,
    save,
    reset,
    reload,
  };
}

/** Persistent host config plus a file-system scan keyed by the config revision. */
export function useHub() {
  const settings = useConfig();
  const scanSkills = useRpc(scanRpc);
  const revision = settings.status === "ready" ? settings.revision : undefined;
  const scan = useQuery({
    queryKey: [...SCAN_KEY, revision ?? ""],
    queryFn: () => scanSkills({}),
    enabled: revision !== undefined,
    placeholderData: keepPreviousData,
  });
  return { settings, scan };
}
