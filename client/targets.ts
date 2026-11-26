import { knownDir } from "../shared/config";
import type { Translate } from "./i18n";

/** Display name: the user's name, else the known directory's label, else the path's last folder. */
export function targetLabel(t: Translate, target: { name: string; path: string }): string {
  if (target.name.trim()) return target.name.trim();
  const known = knownDir(target.path);
  if (known) return known.name || t("target.shared");
  const parts = target.path.split(/[\\/]/).filter(Boolean);
  const last = parts[parts.length - 1] ?? target.path;
  return last === "skills" && parts.length > 1 ? parts[parts.length - 2] : last;
}

/** Agents known to read this directory, or null for directories Skill Hub knows nothing about. */
export function targetReaders(path: string): string | null {
  return knownDir(path)?.readers ?? null;
}
