import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const gitInspectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("missing") }).strict(),
  z.object({ kind: z.literal("not_git") }).strict(),
  z
    .object({
      kind: z.literal("git"),
      hasUncommittedChanges: z.boolean(),
      unpushedCommitCount: z.number().int().nonnegative(),
      branches: z.array(
        z
          .object({
            remoteUrl: z.string().nullable(),
            branch: z.string().min(1),
          })
          .strict(),
      ),
    })
    .strict(),
]);
export type GitInspection = z.infer<typeof gitInspectionSchema>;

export const pruneHostContract = defineRpcContract({
  inspectGit: {
    input: z.object({ path: z.string().min(1) }).strict(),
    output: gitInspectionSchema,
  },
});

export const previewGroupSchema = z
  .object({
    rootId: z.string(),
    title: z.string(),
    projectName: z.string().nullable(),
    branchName: z.string().nullable(),
    lastActiveAt: z.number(),
    threadIds: z.array(z.string()).min(1),
  })
  .strict();
export type PreviewGroup = z.infer<typeof previewGroupSchema>;

export const previewSchema = z
  .object({ groups: z.array(previewGroupSchema) })
  .strict();
export type Preview = z.infer<typeof previewSchema>;

export const pruneInputSchema = z
  .object({ rootIds: z.array(z.string().min(1)) })
  .strict();
export type PruneInput = z.infer<typeof pruneInputSchema>;

export const pruneResultSchema = z
  .object({
    deletedThreadIds: z.array(z.string()),
    failed: z.array(
      z.object({ threadId: z.string(), message: z.string() }).strict(),
    ),
  })
  .strict();
export type PruneResult = z.infer<typeof pruneResultSchema>;

export const statusSchema = z
  .object({
    threadCount: z.number().int().nonnegative(),
    checkedAt: z.number(),
  })
  .strict();
export type Status = z.infer<typeof statusSchema>;

export const pruneRpc = defineRpcContract({
  status: {
    input: z.null(),
    output: statusSchema,
  },
  preview: {
    input: z.null(),
    output: previewSchema,
  },
  prune: {
    input: pruneInputSchema,
    output: pruneResultSchema,
  },
});
