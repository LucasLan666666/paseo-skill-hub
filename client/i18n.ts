import type { LanguageChoice } from "../shared/config";
import { ERROR_CODES } from "../shared/contracts";

/**
 * Bundled string tables. The host translation hook is avoided on purpose: on native clients it
 * is new and a throw during render is fatal, and it cannot force a language. "System" follows the
 * device locale through Intl.
 */
const en = {
  "tab.skills": "Skills",
  "tab.settings": "Settings",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.add": "Add",
  "common.retry": "Retry",
  "common.delete": "Delete",
  "common.loading": "Loading…",
  "common.openSettings": "Open settings",

  "skills.search": "Search name, description or path",
  "skills.searchLabel": "Search skills",
  "skills.clearSearch": "Clear search",
  "skills.stats": "Skills: {skills} · Agents: {agents} · Tap a name to preview",
  "skills.refresh": "Refresh",
  "skills.refreshing": "Refreshing",
  "skills.pull": "Pull",
  "skills.pulling": "Pulling",
  "skills.selected": "Selected: {count}",
  "skills.targets": "Targets",
  "skills.deploy": "Deploy",
  "skills.undeploy": "Undeploy",
  "skills.clearSelection": "Clear selection",
  "skills.selectAll": "Select all",
  "skills.select": "Select {name}",
  "skills.preview": "Preview {name}",
  "skills.column": "Skill · {count}",
  "skills.noMatch": "No matching skills",
  "skills.duplicate": "Duplicate",
  "skills.brokenBanner": "Broken links: {count}. Their target directories no longer exist.",
  "skills.view": "View",
  "skills.missingSources": "Source directory not found: {paths}",
  "skills.truncated": "A source directory is too large, so the scan was truncated. Use a more specific directory.",
  "skills.settingsError": "Cannot read settings: {error}",
  "skills.scanError": "Scan failed: {error}",
  "skills.emptySources.title": "Add a skill source directory",
  "skills.emptySources.text":
    "Skill Hub finds directories containing SKILL.md, references them in place, and deploys them to agents with symlinks.",
  "skills.emptySkills.title": "No skills found",
  "skills.emptySkills.text": "No subdirectory of the sources contains a SKILL.md.",
  "skills.checkSources": "Check sources",
  "skills.noAgents.title": "No agents enabled",
  "skills.noAgents.text": "Enable at least one agent in Settings to deploy skills.",
  "skills.agentDir": "{name}: {dir}",
  "skills.agentDirMissing": "{name}: {dir} (created on first deploy)",
  "skills.done": "Done: {count}",
  "skills.doneSkipped": "Done: {count}. Skipped conflicts: {skipped}",
  "skills.failed": "Failed: {count}. {error}",
  "skills.nothingToDeploy": "Nothing to deploy. Conflicts: {skipped}",
  "skills.nothingToChange": "Nothing to change",
  "skills.agentsColumn": "{name} skills directory",

  "cell.linked": "Deployed",
  "cell.none": "Not deployed",
  "cell.conflict": "Path conflict",
  "cell.broken": "Broken link",
  "cell.source": "Original",
  "cell.brokenToast": "{agent} has a broken link with this name (points to {target}). Clean up broken links first.",
  "cell.sourceToast": "The original of {skill} is inside the {agent} skills directory.",
  "cell.conflictDirectory": "{agent}: a directory with this name already exists. It will not be overwritten.",
  "cell.conflictFile": "{agent}: a file with this name already exists. It will not be overwritten.",
  "cell.conflictLink": "{agent}: an existing link points to {target}. It will not be overwritten.",
  "cell.conflictError": "{agent}: {target}",

  "broken.title": "Broken links",
  "broken.text": "These symlinks point to directories that no longer exist. Cleaning removes only the links.",
  "broken.clean": "Clean all",
  "broken.cleaning": "Cleaning",
  "broken.done": "Removed broken links: {count}",
  "broken.partial": "Removed: {count}. Failed: {failed}. {error}",

  "preview.deployedTo": "Deployed to {agents}",
  "preview.notDeployed": "Not deployed",
  "preview.truncated": "The file is long; showing the first 512 KB.",
  "preview.parent": "Nested inside {name}; deployed separately",
  "preview.children": "Nested skills: {count}, each deployed separately",

  "pull.updated": "Updated repositories: {count}",
  "pull.upToDate": "Already up to date",
  "pull.failed": "{source}: {error}",

  "settings.sources": "Skill sources",
  "settings.sourcesEmpty": "No source directories yet",
  "settings.sourcesEmptyHint": "Skill Hub finds directories containing SKILL.md and references them in place.",
  "settings.skillCount": "Skills: {count}",
  "settings.gitHint": "Git {branch} · Skills: {count}",
  "settings.notAbsolute": "Not an absolute path",
  "settings.notFound": "Directory not found",
  "settings.remove": "Remove {path}",
  "settings.pull": "Pull {path}",
  "settings.agents": "Agents",
  "settings.customAgent": "Custom agent",
  "settings.edit": "Edit {name}",
  "settings.showInMatrix": "Show {name} in the matrix",
  "settings.agentsNote":
    "Deploying creates a symlink to the source directory inside the agent's skills directory. Undeploying removes only that link.",
  "settings.modified": "modified",
  "settings.custom": "custom",
  "settings.notCreated": "not created yet",
  "settings.language": "Language",
  "settings.languageLabel": "Display language",
  "settings.saveFailed": "Save failed. The settings may have changed elsewhere and were reloaded.",
  "settings.invalid": "Invalid settings: {error}",
  "settings.reset": "Reset to defaults",
  "settings.readError": "Cannot read settings: {error}",
  "lang.system": "System",

  "dialog.addSource": "Add source directory",
  "dialog.directory": "Directory",
  "dialog.sourceHint":
    "Finds directories containing SKILL.md, including skills nested inside other skills, skipping hidden directories and node_modules, up to 6 levels deep.",
  "dialog.needAbsolute": "Enter an absolute path or one starting with ~",
  "dialog.duplicate": "This directory is already in the list",
  "dialog.editAgent": "Edit {name}",
  "dialog.addAgent": "Add custom agent",
  "dialog.name": "Name",
  "dialog.skillsDir": "Skills directory",
  "dialog.needName": "Enter a name",
  "dialog.default": "Default: {path}.",
  "dialog.autoCreate": "If the directory is missing, the first deploy creates it.",
  "dialog.restoreDefault": "Restore default",

  "error.E_CONFIG": "Invalid Skill Hub settings",
  "error.E_AGENT": "The agent does not exist or is disabled",
  "error.E_AGENT_PATH": "The agent's skills directory is not an absolute path",
  "error.E_SKILL_PATH": "The skill path must be absolute",
  "error.E_SKILL_MISSING": "The skill directory does not exist",
  "error.E_OUTSIDE": "The skill is not inside a configured source",
  "error.E_NO_SKILL_MD": "The skill directory has no SKILL.md",
  "error.E_OCCUPIED": "The target path is occupied. Nothing was overwritten.",
  "error.E_BROKEN": "A broken link occupies the target path. Clean it up first.",
  "error.E_SOURCE": "The original directory is at the target path and will not be removed",
  "error.E_NOT_AGENT_DIR": "Not inside an enabled agent directory",
  "error.E_NOT_BROKEN": "Not a broken link",
  "error.E_NOT_SOURCE": "Not a configured source directory",
  "error.E_NOT_GIT": "Not a git repository",
};

export type MessageKey = keyof typeof en;

const zhCN: Record<MessageKey, string> = {
  "tab.skills": "Skills",
  "tab.settings": "设置",
  "common.cancel": "取消",
  "common.save": "保存",
  "common.add": "添加",
  "common.retry": "重试",
  "common.delete": "删除",
  "common.loading": "加载中…",
  "common.openSettings": "前往设置",

  "skills.search": "搜索名称、描述或路径",
  "skills.searchLabel": "搜索 Skills",
  "skills.clearSearch": "清除搜索",
  "skills.stats": "{skills} 个 Skills · {agents} 个 Agent · 点击名称预览",
  "skills.refresh": "刷新",
  "skills.refreshing": "刷新中",
  "skills.pull": "拉取",
  "skills.pulling": "拉取中",
  "skills.selected": "已选 {count} 个",
  "skills.targets": "目标",
  "skills.deploy": "部署",
  "skills.undeploy": "取消部署",
  "skills.clearSelection": "清除选择",
  "skills.selectAll": "全选",
  "skills.select": "选择 {name}",
  "skills.preview": "预览 {name}",
  "skills.column": "Skill · {count}",
  "skills.noMatch": "没有匹配的 Skill",
  "skills.duplicate": "重名",
  "skills.brokenBanner": "{count} 个失效链接：目标目录已不存在",
  "skills.view": "查看",
  "skills.missingSources": "来源目录不存在：{paths}",
  "skills.truncated": "来源目录过大，扫描已截断。请改用更具体的目录。",
  "skills.settingsError": "无法读取配置：{error}",
  "skills.scanError": "扫描失败：{error}",
  "skills.emptySources.title": "添加 Skill 来源目录",
  "skills.emptySources.text":
    "Skill Hub 会递归查找包含 SKILL.md 的目录，原地引用这些 Skills，并通过软链接部署到各个 Agent。",
  "skills.emptySkills.title": "没有找到 Skill",
  "skills.emptySkills.text": "来源目录中没有包含 SKILL.md 的子目录。",
  "skills.checkSources": "检查来源目录",
  "skills.noAgents.title": "没有启用的 Agent",
  "skills.noAgents.text": "在设置中启用至少一个 Agent 后即可部署 Skills。",
  "skills.agentDir": "{name}：{dir}",
  "skills.agentDirMissing": "{name}：{dir}（尚未创建，部署时自动创建）",
  "skills.done": "已完成 {count} 项",
  "skills.doneSkipped": "已完成 {count} 项，跳过 {skipped} 项冲突",
  "skills.failed": "{count} 项失败：{error}",
  "skills.nothingToDeploy": "没有可部署的项，{skipped} 项存在冲突",
  "skills.nothingToChange": "没有需要变更的项",
  "skills.agentsColumn": "{name} 的 Skills 目录",

  "cell.linked": "已部署",
  "cell.none": "未部署",
  "cell.conflict": "路径冲突",
  "cell.broken": "失效链接",
  "cell.source": "原始目录",
  "cell.brokenToast": "{agent} 中的同名链接已失效（指向 {target}），请先清理失效链接",
  "cell.sourceToast": "{skill} 的原始目录就在 {agent} 的 Skills 目录中",
  "cell.conflictDirectory": "{agent}：已存在同名目录，不会覆盖",
  "cell.conflictFile": "{agent}：已存在同名文件，不会覆盖",
  "cell.conflictLink": "{agent}：已有链接指向 {target}，不会覆盖",
  "cell.conflictError": "{agent}：{target}",

  "broken.title": "失效链接",
  "broken.text": "以下软链接指向的目录已不存在。清理只删除这些链接本身。",
  "broken.clean": "全部清理",
  "broken.cleaning": "清理中",
  "broken.done": "已清理 {count} 个失效链接",
  "broken.partial": "已清理 {count} 个，{failed} 个失败：{error}",

  "preview.deployedTo": "已部署到 {agents}",
  "preview.notDeployed": "尚未部署",
  "preview.truncated": "内容过长，仅显示前 512 KB。",
  "preview.parent": "位于 {name} 内，需单独部署",
  "preview.children": "包含 {count} 个子 Skill，需各自单独部署",

  "pull.updated": "已更新 {count} 个仓库",
  "pull.upToDate": "已是最新",
  "pull.failed": "{source}：{error}",

  "settings.sources": "Skill 来源目录",
  "settings.sourcesEmpty": "尚未添加来源目录",
  "settings.sourcesEmptyHint": "Skill Hub 会递归查找其中包含 SKILL.md 的目录，并原地引用。",
  "settings.skillCount": "{count} 个 Skills",
  "settings.gitHint": "Git {branch} · {count} 个 Skills",
  "settings.notAbsolute": "不是绝对路径",
  "settings.notFound": "目录不存在",
  "settings.remove": "移除 {path}",
  "settings.pull": "拉取 {path}",
  "settings.agents": "Agents",
  "settings.customAgent": "自定义 Agent",
  "settings.edit": "编辑 {name}",
  "settings.showInMatrix": "在矩阵中显示 {name}",
  "settings.agentsNote": "部署会在 Agent 的 Skills 目录中创建指向源目录的软链接；取消部署只删除该链接。",
  "settings.modified": "已修改",
  "settings.custom": "自定义",
  "settings.notCreated": "目录尚未创建",
  "settings.language": "语言",
  "settings.languageLabel": "界面语言",
  "settings.saveFailed": "保存失败，配置可能已在别处修改，已重新加载",
  "settings.invalid": "配置无效：{error}",
  "settings.reset": "恢复默认",
  "settings.readError": "无法读取配置：{error}",
  "lang.system": "跟随系统",

  "dialog.addSource": "添加来源目录",
  "dialog.directory": "目录",
  "dialog.sourceHint": "递归查找包含 SKILL.md 的目录，也会查找 Skill 内部嵌套的子 Skill（跳过隐藏目录和 node_modules，最多 6 层）。",
  "dialog.needAbsolute": "请输入绝对路径，或以 ~ 开头的路径",
  "dialog.duplicate": "该目录已在列表中",
  "dialog.editAgent": "编辑 {name}",
  "dialog.addAgent": "添加自定义 Agent",
  "dialog.name": "名称",
  "dialog.skillsDir": "Skills 目录",
  "dialog.needName": "请输入名称",
  "dialog.default": "默认：{path}。",
  "dialog.autoCreate": "目录不存在时，首次部署会自动创建。",
  "dialog.restoreDefault": "恢复默认",

  "error.E_CONFIG": "Skill Hub 配置无效",
  "error.E_AGENT": "Agent 不存在或未启用",
  "error.E_AGENT_PATH": "Agent 的 Skills 目录不是绝对路径",
  "error.E_SKILL_PATH": "Skill 路径必须是绝对路径",
  "error.E_SKILL_MISSING": "Skill 目录不存在",
  "error.E_OUTSIDE": "Skill 不在已配置的来源目录中",
  "error.E_NO_SKILL_MD": "Skill 目录缺少 SKILL.md",
  "error.E_OCCUPIED": "目标路径已被占用，未覆盖",
  "error.E_BROKEN": "目标路径是失效链接，请先清理",
  "error.E_SOURCE": "目标路径是原始目录，不会删除",
  "error.E_NOT_AGENT_DIR": "不在已启用的 Agent 目录中",
  "error.E_NOT_BROKEN": "不是失效链接",
  "error.E_NOT_SOURCE": "不是已配置的来源目录",
  "error.E_NOT_GIT": "不是 Git 仓库",
};

export type Lang = "en" | "zh-CN";
export type Vars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: Vars) => string;

/** Display names are written in their own language, so they never change with the UI language. */
export const LANGUAGE_NAMES: Record<Lang, string> = { en: "English", "zh-CN": "简体中文" };

function systemLang(): Lang {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale.toLowerCase().startsWith("zh")) return "zh-CN";
  } catch {
    // An engine without Intl falls back to English.
  }
  return "en";
}

export function resolveLang(choice: LanguageChoice | undefined): Lang {
  return !choice || choice === "system" ? systemLang() : choice;
}

export function translator(lang: Lang): Translate {
  const table = lang === "zh-CN" ? zhCN : en;
  return (key, vars) =>
    (table[key] ?? en[key]).replace(/\{(\w+)\}/g, (match, name: string) =>
      vars && name in vars ? String(vars[name]) : match,
    );
}

/** Translates server error codes (optionally followed by `: detail`); other text stays raw. */
export function localizeError(t: Translate, error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const match = /\b(E_[A-Z_]+)\b(?::\s*([\s\S]*))?/.exec(text);
  if (!match || !(ERROR_CODES as readonly string[]).includes(match[1])) return text;
  const label = t(`error.${match[1]}` as MessageKey);
  return match[2] ? `${label}: ${match[2]}` : label;
}
