import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { pruneHostContract, type GitInspection } from "./lib/contract.js";

function git(args: string[], cwd: string, signal: AbortSignal) {
  return new Promise<{ exitCode: number; stdout: string }>(
    (resolve, reject) => {
      execFile(
        "git",
        args,
        { cwd, signal, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout) => {
          if (error === null) return resolve({ exitCode: 0, stdout });
          if (typeof error.code === "number")
            return resolve({ exitCode: error.code, stdout });
          reject(error);
        },
      );
    },
  );
}

export async function inspectGit(
  path: string,
  signal: AbortSignal,
): Promise<GitInspection> {
  try {
    await fs.access(path);
  } catch {
    return { kind: "missing" };
  }
  const inside = await git(
    ["rev-parse", "--is-inside-work-tree"],
    path,
    signal,
  );
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true")
    return { kind: "not_git" };
  const status = await git(
    [
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ],
    path,
    signal,
  );
  if (status.exitCode !== 0) throw new Error("git status failed");
  const head = await git(
    ["rev-parse", "--verify", "--quiet", "HEAD"],
    path,
    signal,
  );
  let unpushedCommitCount = 0;
  if (head.exitCode === 0) {
    const ahead = await git(
      ["rev-list", "--count", "HEAD", "--not", "--remotes"],
      path,
      signal,
    );
    if (ahead.exitCode !== 0) throw new Error("git rev-list failed");
    unpushedCommitCount = Number(ahead.stdout.trim());
  }
  return {
    kind: "git",
    hasUncommittedChanges: status.stdout.trim().length > 0,
    unpushedCommitCount,
    branches: await readBranches(path, signal),
  };
}

async function readBranches(path: string, signal: AbortSignal) {
  const head = await git(
    ["symbolic-ref", "--short", "-q", "HEAD"],
    path,
    signal,
  );
  const current = head.exitCode === 0 ? head.stdout.trim() : "";
  if (current.length === 0) return [];
  const config = async (key: string) => {
    const result = await git(["config", "--get", key], path, signal);
    const value = result.stdout.trim();
    return result.exitCode === 0 && value.length > 0 ? value : null;
  };
  const remoteUrl = async (remote: string) => {
    const result = await git(["remote", "get-url", remote], path, signal);
    const value = result.stdout.trim();
    return result.exitCode === 0 && value.length > 0 ? value : null;
  };
  const remote = (await config(`branch.${current}.remote`)) ?? "origin";
  const merge = await config(`branch.${current}.merge`);
  const url = await remoteUrl(remote);
  const branches = [{ remoteUrl: url, branch: current }];
  const upstream = merge?.replace(/^refs\/heads\//, "");
  if (upstream !== undefined && upstream.length > 0 && upstream !== current)
    branches.push({ remoteUrl: url, branch: upstream });
  return branches;
}

export default experimental_defineHostEntry({
  contract: pruneHostContract,
  handlers: {
    inspectGit: (input, context) => inspectGit(input.path, context.signal),
  },
});
