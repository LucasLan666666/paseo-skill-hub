# Skill Hub

Skill Hub adds a sidebar entry to Paseo for managing which skills your agents can use, from one matrix of skills and target directories. Skills stay in your own directories and are referenced in place. Deploying a skill creates a symlink to its source directory inside a target directory that agents read; nothing is copied and there is no central store.

## Setup

Add one or more skill source directories under Settings. Skill Hub recursively finds directories containing `SKILL.md`, skipping hidden directories and `node_modules`, going at most 6 levels deep, and not following symlinks. It also looks inside skills for nested skills, which appear indented under their parent. It reads `name` and `description` from the frontmatter.

Most agents read the shared `~/.agents/skills` directory, and Claude Code reads `~/.claude/skills`, so these two are the default targets:

| Target | Read by |
| --- | --- |
| `~/.agents/skills` (Shared) | Codex, Pi, Oh My Pi, Antigravity |
| `~/.claude/skills` | Claude Code |

This was checked against each agent's code on one machine; OpenCode, Copilot, and Muse Code were not confirmed. Add other directories as targets when an agent needs its own, for example `~/.config/opencode/skills` or `~/.copilot/skills`; the add dialog suggests these. Deploying the same skill to several directories that one agent reads can make that agent list it twice.

The interface language can follow the system or be set to English or Simplified Chinese. Settings are stored in a local file on each daemon host (`~/.config/paseo-skill-hub/config.json`, or `%APPDATA%\paseo-skill-hub\config.json` on Windows), so every host is configured separately and the configuration survives uninstalling and reinstalling the plugin. All file operations run on the selected host.

## Usage

- Tap a matrix cell to deploy or undeploy. Select several skills to deploy or undeploy them in chosen targets at once.
- Tap a skill name to read its description and preview its `SKILL.md`.
- Deployment state is read from the file system every time. Existing symlinks, including relative ones, are recognized as deployed.
- When a directory, a file, or a link to somewhere else already occupies the path, the cell shows a conflict and nothing is overwritten.
- Symlinks whose targets no longer exist are listed as broken links and can be cleaned up after confirmation. Cleaning removes only the links.
- When a skill's original directory is itself inside a target directory, that cell shows as the original and cannot be toggled.
- A nested skill is deployed separately from its parent: deploying the parent links the whole parent directory, but agents only pick up the nested skill when it has its own link. Templates that ship a `SKILL.md` inside a skill are listed too; leave them undeployed.
- When the same directory name appears in several sources, the skills are marked as duplicates because they would use the same link name.
- Sources inside a git repository can pull the latest version, one repository at a time from its row in Settings or all at once with Pull all. Each repository shows its own progress and result. Pulling runs `git pull --ff-only`, so it never merges, rebases, or discards local changes. Any credentials must already be configured on the daemon host; Skill Hub never prompts for them. Repositories rooted at the home directory or above are ignored. Pulling contacts only the remote configured in that repository; Skill Hub makes no other network requests.

Undeploying removes only the symlink that points at that skill, never source files or other directories. If a target directory does not exist, the first deploy creates it. On Windows, directory junctions are used.
