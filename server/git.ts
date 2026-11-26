import { execFile } from "node:child_process";
import { resolve, sep } from "node:path";

function git(
  args: string[],
  cwd: string,
  timeout: number,
  options: { defaultBatchSsh?: boolean } = {},
): Promise<string> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Never wait for a terminal or GUI credential prompt on the daemon.
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
  };
  if (options.defaultBatchSsh && !env.GIT_SSH_COMMAND) {
    env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  }
  return new Promise((done, fail) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024,
        env,
      },
      (error, stdout, stderr) => {
        if (!error) return done(`${stdout}${stderr}`);
        const detail = `${stderr}`.trim() || error.message;
        fail(new Error(detail.split("\n").filter(Boolean).slice(-3).join("\n")));
      },
    );
  });
}

async function hasSshCommandConfig(dir: string): Promise<boolean> {
  try {
    return (await git(["config", "--get", "core.sshCommand"], dir, 5000)).trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Root and branch of the work tree containing `dir`, or null when it is not in one. Repositories
 * rooted at the home directory or above (dotfiles repos) are ignored so pulling never touches them.
 */
export async function gitInfo(dir: string, home: string): Promise<{ root: string; branch: string } | null> {
  try {
    const [root, branch] = (await git(["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"], dir, 5000))
      .trim()
      .split("\n");
    const top = resolve(root);
    const homeDir = resolve(home);
    if (top === homeDir || homeDir.startsWith(top.endsWith(sep) ? top : top + sep)) return null;
    return { root: top, branch: branch || "HEAD" };
  } catch {
    return null;
  }
}

/** Fast-forward-only pull; never merges, rebases, or discards local changes. */
export async function gitPull(dir: string): Promise<{ changed: boolean; message: string }> {
  const head = () => git(["rev-parse", "HEAD"], dir, 5000).then((out) => out.trim());
  const before = await head();
  const defaultBatchSsh = !(await hasSshCommandConfig(dir));
  const output = await git(["-c", "pull.rebase=false", "pull", "--ff-only"], dir, 120_000, {
    defaultBatchSsh,
  });
  const after = await head();
  const lines = output.trim().split("\n").filter(Boolean);
  return { changed: before !== after, message: lines.at(-1) ?? "" };
}
