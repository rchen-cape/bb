---
name: prune-threads
description: "How the Prune threads plugin decides which threads the Prune button and `bb prune` delete. Use when the user asks to prune or bulk-delete old threads, or asks why a thread was or was not pruned."
---

# Prune threads

The plugin adds a **Prune** button next to **New thread** at the top of the
sidebar, and a `bb prune` command. Both delete the same threads.

## Which threads are deleted

A thread is deleted only when all of these are true:

- It is idle: not running, no queued messages, no background agents,
  workflows, commands, plan mode, or goals.
- It needs nothing from the user: no pending question or approval, and the
  agent's last turn did not end with a question.
- It has been read.
- Its last activity (creation, status change, or new result) was more than
  24 hours ago.
- It is not pinned and not archived.
- Its environment has no uncommitted or untracked files, and no commits that
  are missing from every remote. Threads without an environment pass. If the
  machine cannot be reached, the thread is kept.

- It is not working on a PR that is still on the PR board. A thread counts as
  working on a PR when either:
  - PR Board created it (a Review, Address comments, or Explain thread). The
    plugin reads the PR from PR Board's thread metadata, so renamed threads
    still count.
  - Its checkout is on the PR's head branch, or its branch tracks that head
    branch, in the same GitHub repo. This covers PR threads you started
    yourself.

  A PR that is no longer on the board was merged or closed. If the board
  cannot be read, or reports a fetch error, every PR Board thread and every
  thread with a git branch is kept.

Child threads, side threads, and their parent are one group. If any thread in
a group fails a check, the whole group is kept.

## Commands

- `bb prune` lists the thread groups that would be deleted, as JSON. Each
  group has a `rootId`, title, project, branch, last activity time, and the
  IDs of every thread in it. It deletes nothing.
- `bb prune --yes` deletes every listed group and prints the deleted IDs and
  any failures.
- `bb prune --yes --keep thr_a,thr_b` deletes every listed group except the
  ones with those root IDs.

The server recounts prunable threads every 5 minutes, about 10 seconds after
a thread finishes, is archived, unarchived, or deleted, and after each prune.
The button reads that count every minute and when the window comes back into
view. With nothing to prune the button is hidden; otherwise it reads "Prune"
and its tooltip shows the count.

The button opens a dialog with one checked row per group. Unchecked rows are
kept. Deletion cannot be undone.
