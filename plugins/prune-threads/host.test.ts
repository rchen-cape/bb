import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectGit } from "./host.js";

const roots: string[] = [];
const signal = new AbortController().signal;

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prune-threads-"));
  roots.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]) {
  execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
    stdio: "ignore",
  });
}

async function clonedRepo() {
  const root = await tempDir();
  const remote = path.join(root, "remote.git");
  const work = path.join(root, "work");
  git(root, "init", "--bare", "-b", "main", remote);
  git(root, "clone", remote, work);
  await fs.writeFile(path.join(work, "a.txt"), "a");
  git(work, "add", ".");
  git(work, "commit", "-m", "a");
  git(work, "push", "origin", "main");
  return work;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("inspectGit", () => {
  it("reports a missing path", async () => {
    const dir = await tempDir();
    expect(await inspectGit(path.join(dir, "nope"), signal)).toEqual({
      kind: "missing",
    });
  });

  it("reports a plain folder", async () => {
    expect(await inspectGit(await tempDir(), signal)).toEqual({
      kind: "not_git",
    });
  });

  it("reports a pushed, clean checkout as clean", async () => {
    expect(await inspectGit(await clonedRepo(), signal)).toMatchObject({
      kind: "git",
      hasUncommittedChanges: false,
      unpushedCommitCount: 0,
    });
  });

  it("reports untracked files as uncommitted changes", async () => {
    const work = await clonedRepo();
    await fs.writeFile(path.join(work, "new.txt"), "new");
    expect(await inspectGit(work, signal)).toMatchObject({
      hasUncommittedChanges: true,
    });
  });

  it("counts commits not on any remote", async () => {
    const work = await clonedRepo();
    git(work, "checkout", "-b", "feature");
    await fs.writeFile(path.join(work, "b.txt"), "b");
    git(work, "add", ".");
    git(work, "commit", "-m", "b");
    expect(await inspectGit(work, signal)).toMatchObject({
      kind: "git",
      hasUncommittedChanges: false,
      unpushedCommitCount: 1,
    });
  });

  it("counts every commit in a repo with no remote", async () => {
    const work = await tempDir();
    git(work, "init", "-b", "main");
    await fs.writeFile(path.join(work, "a.txt"), "a");
    git(work, "add", ".");
    git(work, "commit", "-m", "a");
    expect(await inspectGit(work, signal)).toMatchObject({
      unpushedCommitCount: 1,
    });
  });

  it("reports the checked-out branch and the remote it pushes to", async () => {
    const work = await clonedRepo();
    const inspection = await inspectGit(work, signal);
    expect(inspection.kind === "git" && inspection.branches).toEqual([
      { remoteUrl: expect.stringContaining("remote.git"), branch: "main" },
    ]);
  });

  it("also reports the upstream branch a worktree branch tracks", async () => {
    const work = await clonedRepo();
    git(
      work,
      "checkout",
      "-b",
      "bb/address-comments",
      "--track",
      "origin/main",
    );
    const inspection = await inspectGit(work, signal);
    expect(
      inspection.kind === "git" && inspection.branches.map((ref) => ref.branch),
    ).toEqual(["bb/address-comments", "main"]);
  });

  it("reports no branch when HEAD is detached", async () => {
    const work = await clonedRepo();
    git(work, "checkout", "--detach");
    expect(await inspectGit(work, signal)).toMatchObject({ branches: [] });
  });

  it("treats an empty repo with nothing staged as clean", async () => {
    const work = await tempDir();
    git(work, "init", "-b", "main");
    expect(await inspectGit(work, signal)).toMatchObject({
      kind: "git",
      hasUncommittedChanges: false,
      unpushedCommitCount: 0,
    });
  });
});
