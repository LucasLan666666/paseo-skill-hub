# Skill Hub

Skill Hub adds a sidebar entry to Paseo for managing the skills of several agents from one Skill × Agent matrix. Skills stay in your own directories and are referenced in place. Deploying a skill creates a symlink to its source directory inside an agent's skills directory; nothing is copied and there is no central store.

## Setup

Add one or more skill source directories under Settings. Skill Hub recursively finds directories containing `SKILL.md`, skipping hidden directories and `node_modules`, going at most 6 levels deep, and not following symlinks. It also looks inside skills for nested skills, which appear indented under their parent. It reads `name` and `description` from the frontmatter.

Paseo's built-in agents come with default paths that you can change, restore, or hide from the matrix:

| Agent | Default skills directory |
| --- | --- |
| Claude Code | `~/.claude/skills` |
| Codex | `~/.agents/skills` |
| Copilot | `~/.copilot/skills` |
| OpenCode | `~/.config/opencode/skills` |
| Pi | `~/.pi/agent/skills` |
| Oh My Pi | `~/.omp/agent/skills` |
| Antigravity | `~/.gemini/config/skills` |
| Muse Code | `~/.config/muse/skills` |

You can also add custom agents with their own skills directories. The interface language can follow the system or be set to English or Simplified Chinese. Settings are stored on each daemon host, so every host is configured separately, and all file operations run on the selected host.

## Usage

- Tap a matrix cell to deploy or undeploy. Select several skills to deploy or undeploy them for chosen agents at once.
- Tap a skill name to read its description and preview its `SKILL.md`.
- Deployment state is read from the file system every time. Existing symlinks, including relative ones, are recognized as deployed.
- When a directory, a file, or a link to somewhere else already occupies the path, the cell shows a conflict and nothing is overwritten.
- Symlinks whose targets no longer exist are listed as broken links and can be cleaned up after confirmation. Cleaning removes only the links.
- When a skill's original directory is itself inside an agent's skills directory, that cell shows as the original and cannot be toggled.
- A nested skill is deployed separately from its parent: deploying the parent links the whole parent directory, but agents only pick up the nested skill when it has its own link. Templates that ship a `SKILL.md` inside a skill are listed too; leave them undeployed.
- When the same directory name appears in several sources, the skills are marked as duplicates because they would use the same link name.
- Sources inside a git repository can pull the latest version. Pulling runs `git pull --ff-only`, so it never merges, rebases, or discards local changes. Any credentials must already be configured on the daemon host; Skill Hub never prompts for them. Repositories rooted at the home directory or above are ignored.

Undeploying removes only the symlink that points at that skill, never source files or other directories. If an agent's skills directory does not exist, the first deploy creates it. On Windows, directory junctions are used.
