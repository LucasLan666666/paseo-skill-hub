import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { configSettings } from "../shared/config";
import { scanRpc } from "../shared/contracts";

export const SCAN_KEY = ["skill-hub", "scan"] as const;

/** Host settings plus a file-system scan keyed by the settings revision. */
export function useHub() {
  const settings = useSettings(configSettings);
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
