import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { pullRpc, type SourceStatus } from "../shared/contracts";
import { SCAN_KEY } from "./data";
import { localizeError, type Translate } from "./i18n";

const PULL_KEY = ["skill-hub", "pull"] as const;

export interface PullResult {
  source: string;
  ok: boolean;
  changed: boolean;
  message: string;
}

/**
 * One request per repository, so every source shows its own progress and result, and a repository
 * shared by several sources is never pulled twice at once. State lives in the installation's
 * mutation cache, so the Skills and Settings pages show the same pulls.
 */
export function usePull(sources: readonly SourceStatus[]) {
  const pullSources = useRpc(pullRpc);
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: PULL_KEY,
    mutationFn: async (source: string): Promise<PullResult> => {
      try {
        const [result] = (await pullSources({ sources: [source] })).results;
        return result ?? { source, ok: false, changed: false, message: "" };
      } catch (error) {
        return { source, ok: false, changed: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SCAN_KEY }),
  });
  const pending = useMutationState({
    filters: { mutationKey: PULL_KEY, status: "pending" },
    select: (mutation) => mutation.state.variables as string,
  });
  const finished = useMutationState({
    filters: { mutationKey: PULL_KEY, status: "success" },
    select: (mutation) => mutation.state.data as PullResult,
  });

  const gitSources = sources.filter((source) => source.gitRoot !== null);
  const rootOf = (path: string) => gitSources.find((source) => source.path === path)?.gitRoot ?? null;
  const busy = new Set(pending.map(rootOf));
  const latest = new Map<string | null, PullResult>();
  for (const result of finished) latest.set(rootOf(result.source), result);

  const isPulling = (source: SourceStatus) => source.gitRoot !== null && busy.has(source.gitRoot);
  const resultFor = (source: SourceStatus) =>
    source.gitRoot !== null && !isPulling(source) ? latest.get(source.gitRoot) : undefined;

  return {
    gitSources,
    isPulling,
    resultFor,
    anyPulling: gitSources.some(isPulling),
    allPulling: gitSources.length > 0 && gitSources.every(isPulling),
    pull: (source: SourceStatus) => mutateAsync(source.path),
    /** Pulls every repository that is not already pulling, all at once. */
    pullAll: () => {
      const byRoot = new Map<string, SourceStatus>();
      for (const source of gitSources) {
        if (!isPulling(source) && !byRoot.has(source.gitRoot!)) byRoot.set(source.gitRoot!, source);
      }
      return Promise.all([...byRoot.values()].map((source) => mutateAsync(source.path)));
    },
  };
}

/** One toast for a "pull all": how many repositories changed, or the first failure. */
export function pullSummary(t: Translate, results: readonly PullResult[]) {
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    return {
      error: true,
      text: t("pull.someFailed", {
        failed: failed.length,
        source: failed[0].source,
        error: localizeError(t, failed[0].message),
      }),
    };
  }
  const changed = results.filter((result) => result.changed).length;
  return { error: false, text: changed > 0 ? t("pull.updated", { count: changed }) : t("pull.upToDate") };
}

/** Short status for a source row: pulling, updated, up to date, or null. Failures go to the row error. */
export function pullStatus(t: Translate, pulling: boolean, result: PullResult | undefined): string | null {
  if (pulling) return t("pull.pending");
  if (!result?.ok) return null;
  return result.changed ? t("pull.rowUpdated") : t("pull.rowUpToDate");
}
