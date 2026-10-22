import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountPruneButton } from "./lib/button.js";
import {
  previewSchema,
  pruneResultSchema,
  statusSchema,
  type PruneInput,
  type pruneRpc,
} from "./lib/contract.js";
import { openPruneDialog } from "./lib/dialog.js";

async function callRpc(
  pluginId: string,
  method: keyof typeof pruneRpc,
  input: unknown,
) {
  const response = await fetch(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    typeof body !== "object" ||
    body === null ||
    !("ok" in body) ||
    body.ok !== true ||
    !("result" in body)
  ) {
    const error =
      typeof body === "object" && body !== null && "error" in body
        ? body.error
        : null;
    const message =
      typeof error === "string"
        ? error
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof error.message === "string"
          ? error.message
          : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body.result;
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "prune-button",
    mount({ pluginId, signal }) {
      const dispose = mountPruneButton(document, {
        status: async () =>
          statusSchema.parse(await callRpc(pluginId, "status", null)),
        preview: async () =>
          previewSchema.parse(await callRpc(pluginId, "preview", null)),
        choose: (preview) => openPruneDialog(document, preview, Date.now()),
        prune: async (rootIds) =>
          pruneResultSchema.parse(
            await callRpc(pluginId, "prune", { rootIds } satisfies PruneInput),
          ),
        alert: (message) => window.alert(message),
      });
      signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  });
});
