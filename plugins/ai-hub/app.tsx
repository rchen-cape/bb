import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { AI_HUB_PANEL_PATH } from "./src/contract.js";
import { AiHubPanel } from "./views/shell.js";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "ai-hub",
    title: "AI Hub",
    icon: "Brain",
    path: AI_HUB_PANEL_PATH,
    component: AiHubPanel,
  });
});
