import { useEffect, useMemo } from "react";
import {
  definePluginApp,
  experimental_copyToClipboard,
  experimental_useCodeTheme,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import {
  createConfigStore,
  defaultConfig,
  readConfig,
  type ReadableThreadsConfig,
} from "./lib/config.js";
import { startClickToCopy } from "./lib/click-to-copy.js";
import { startHighlighter } from "./lib/highlighter.js";
import { buildStylesheet } from "./lib/styles.js";

const configStore = createConfigStore(
  defaultConfig(
    typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  ),
);

function highlighterOptions(config: ReadableThreadsConfig) {
  return {
    enabled: config.keywordHighlights,
    customKeywords: config.customKeywords,
  };
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "readable-threads",
    mount({ signal }) {
      const style = document.createElement("style");
      style.dataset.readableThreads = "";
      document.head.append(style);
      const initial = configStore.get();
      style.textContent = buildStylesheet(initial);
      const highlighter = startHighlighter(
        document,
        highlighterOptions(initial),
      );
      const clickToCopy = startClickToCopy(
        document,
        (text) => experimental_copyToClipboard({ text }),
        initial.clickToCopy,
      );
      const unsubscribe = configStore.subscribe((config) => {
        style.textContent = buildStylesheet(config);
        highlighter.update(highlighterOptions(config));
        clickToCopy.setEnabled(config.clickToCopy);
      });

      let disposed = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        unsubscribe();
        clickToCopy.dispose();
        highlighter.dispose();
        style.remove();
      };
      signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  });

  app.slots.experimental_threadAction({
    id: "readable-threads-config",
    title: "Readable threads",
    icon: "Code",
    group: "9_readable-threads",
    useData() {
      const { values } = useSettings();
      const codeTheme = experimental_useCodeTheme();
      const config = useMemo(
        () => readConfig(values, codeTheme),
        [values, codeTheme],
      );
      useEffect(() => {
        configStore.set(config);
      }, [config]);
      return undefined;
    },
    item: () => null,
  });
});
