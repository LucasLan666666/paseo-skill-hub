# Skill Hub

Skill Hub 在 Paseo 侧边栏中添加一个入口，用一张 Skill × Agent 矩阵统一管理多个 Agent 的 Skills。Skills 保留在你自己的目录中原地引用，部署时在各 Agent 的 Skills 目录里创建指向源目录的软链接，不复制文件，也不建立中心仓库。

## 设置

在「设置」页添加一个或多个 Skill 来源目录。插件递归查找包含 `SKILL.md` 的目录（跳过隐藏目录和 `node_modules`，最多 6 层，不跟随软链接），也会继续查找 Skill 内部嵌套的子 Skill，并将其缩进显示在父级下方。名称和描述读取自 frontmatter 的 `name` 和 `description`。

Paseo 原生 Agent 已带默认路径，可逐个修改、恢复默认或从矩阵中隐藏：

| Agent | 默认 Skills 目录 |
| --- | --- |
| Claude Code | `~/.claude/skills` |
| Codex | `~/.agents/skills` |
| Copilot | `~/.copilot/skills` |
| OpenCode | `~/.config/opencode/skills` |
| Pi | `~/.pi/agent/skills` |
| Oh My Pi | `~/.omp/agent/skills` |
| Antigravity | `~/.gemini/config/skills` |
| Muse Code | `~/.config/muse/skills` |

也可以添加自定义 Agent 及其 Skills 目录。界面语言可选跟随系统、English 或简体中文。配置保存在每个 daemon 主机上，不同 Host 各自独立；所有文件操作都在当前选中的 Host 上执行。

## 使用

- 点击矩阵单元格部署或取消部署。勾选多个 Skill 后，可选择目标 Agent 批量部署或取消部署。
- 点击 Skill 名称查看描述并预览 `SKILL.md` 内容。
- 部署状态每次都从文件系统读取：已有的软链接（包括相对链接）会被识别为已部署。
- 同名路径已被目录、文件或指向别处的链接占用时显示为冲突，插件不会覆盖。
- 指向已不存在目录的软链接会被列为失效链接，可确认后清理；清理只删除链接本身。
- 原始目录本身就位于某个 Agent 的 Skills 目录中时，该单元格显示为原始目录，不可切换。
- 子 Skill 与父级各自独立部署：部署父级会链接整个父目录，但子 Skill 需要有自己的链接才会被 Agent 识别。某些 Skill 内部自带的 `SKILL.md` 模板也会被列出，不部署即可。
- 同一目录名出现在多个来源中时会标记「重名」，因为它们会占用 Agent 目录中的同一个链接名。
- 来源目录位于 Git 仓库中时，可以拉取最新版本。拉取使用 `git pull --ff-only`，不会合并、变基或丢弃本地修改；需要的凭据必须已在 daemon 主机上配置好，插件不会弹出凭据提示。根目录为用户主目录或更上层的仓库会被忽略。

取消部署只删除由该 Skill 部署的软链接，从不删除源文件或其他目录。Agent 的 Skills 目录不存在时，首次部署会自动创建。Windows 上使用目录联接（junction）。
