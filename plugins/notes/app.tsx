import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_useCodeTheme,
  experimental_usePluginId,
  useBbNavigate,
  useRpc,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import type * as MonacoNs from "monaco-editor";
import { toast } from "sonner";
import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import type { rpcContract } from "./server.js";
import { loadMonaco, overflowWidgetsNode, setOverflowWidgetsTheme } from "./lib/monaco-loader.js";
import {
  applyMarkdownTheme,
  editorBackground,
  type WorkbenchColorOverrides,
} from "./lib/markdown-theme.js";
import { DecorationController } from "./lib/decoration-controller.js";
import { NoteAutosave, type SaveState } from "./lib/autosave.js";
import { expandedFoldersStorageKey } from "./lib/expanded-folders.js";
import { findDailyNotePath } from "./lib/daily-note.js";
import {
  buildTree,
  decodeSubPath,
  withMarkdownExtension,
  type FlatEntry,
  type TreeNode,
} from "./lib/notes-tree.js";
import {
  IMPORTED_VSCODE_SETTINGS,
  type NotesSettings,
} from "./lib/vscode-settings.js";
import { collectHeadings, tocBlock, updateTocBlock } from "./lib/toc.js";
import { NotesSidebar, type DraftKind } from "./components/NotesSidebar.js";
import { NotesToolbar, type SaveIndicator } from "./components/NotesToolbar.js";

const PANEL_PATH = "notes";

const closingNotes = new Map<string, Promise<SaveState>>();

type EditorStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isWithin(path: string | null, ancestor: string): path is string {
  return path !== null && (path === ancestor || path.startsWith(`${ancestor}/`));
}

function saveFailed(state: SaveState): boolean {
  return state.kind === "error" || state.kind === "conflict";
}

function reportUnsavedOnLeave(path: string, state: SaveState): void {
  if (state.kind === "conflict") {
    toast.error(`${path} changed on disk, so your last edits were not saved`);
  } else if (state.kind === "error") {
    toast.error(`Could not save ${path}: ${state.message}`);
  }
}

/**
 * Reads a CSS custom property through a throwaway element so the browser
 * resolves it (e.g. `oklch(...)`) to an `rgb()` string, then hex-encodes it.
 * Lets the editor's background/foreground track the app's own --canvas/--ink
 * tokens instead of the much darker/brighter ones a syntax theme ships.
 */
function resolveCssColor(expression: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const probe = document.createElement("span");
  probe.style.color = expression;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const context = document.createElement("canvas").getContext("2d", {
    willReadFrequently: true,
  });
  if (context === null || resolved === "") return undefined;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = resolved;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (alpha !== 255) return undefined;
  const toHex = (value: number) => value.toString(16).padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function resolveEditorColorOverrides(): WorkbenchColorOverrides {
  return {
    background: resolveCssColor(
      "color-mix(in oklab, var(--ink) 7%, var(--canvas))",
    ),
    // The same `text-foreground` thread messages use.
    foreground: resolveCssColor("var(--foreground)"),
  };
}

function NotesPanel({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const codeTheme = experimental_useCodeTheme();
  const pluginId = experimental_usePluginId();

  const codeThemeRef = useRef(codeTheme);
  codeThemeRef.current = codeTheme;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Re-resolved when the mode flips so --canvas/--ink pick up the right
  // light/dark value; cheap, so no need to tie it to anything finer-grained.
  const colorOverrides = useMemo(
    () => resolveEditorColorOverrides(),
    [codeTheme.mode],
  );
  const colorOverridesRef = useRef(colorOverrides);
  colorOverridesRef.current = colorOverrides;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const monacoRef = useRef<typeof MonacoNs | null>(null);
  const editorRef = useRef<MonacoNs.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<DecorationController | null>(null);
  const autosaveRef = useRef<NoteAutosave | null>(null);
  const navigationRef = useRef(0);

  /** The route owns which note is open, so a deep link restores it. */
  const activePath = subPath === "" ? null : decodeSubPath(subPath);
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;

  const [saveState, setSaveState] = useState<SaveState>({ kind: "clean" });
  const [status, setStatus] = useState<EditorStatus>({ kind: "idle" });
  const [settings, setSettings] = useState<NotesSettings>(
    IMPORTED_VSCODE_SETTINGS,
  );
  const [root, setRoot] = useState<string>("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [wordWrap, setWordWrap] = useState(true);
  const [isReloading, setIsReloading] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<TreeNode | null>(null);
  const [tree, setTree] = useState<{
    entries: readonly FlatEntry[];
    truncated: boolean;
    isLoading: boolean;
    error: string | null;
  }>({ entries: [], truncated: false, isLoading: true, error: null });

  const detachAutosave = useCallback((): NoteAutosave | null => {
    const autosave = autosaveRef.current;
    autosaveRef.current = null;
    return autosave;
  }, []);

  const nodes = useMemo(() => buildTree(tree.entries), [tree.entries]);

  const openNote = useCallback(
    (path: string) => {
      navigate.toPluginPanel(PANEL_PATH, { subPath: path });
    },
    [navigate],
  );

  const refreshTree = useCallback(async () => {
    try {
      const result = await rpc.call("tree", null);
      setRoot(result.root);
      setTree({
        entries: result.entries,
        truncated: result.truncated,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setTree({
        entries: [],
        truncated: false,
        isLoading: false,
        error: errorText(error),
      });
    }
  }, [rpc]);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  // With no note selected (entering the panel, or clicking Notes in the
  // sidebar while already here), open today's note. A delete sets the skip
  // flag because it clears the selection before the tree refreshes, and the
  // stale tree could still list the note that was just removed.
  const skipDailyNoteRef = useRef(false);
  useEffect(() => {
    if (tree.isLoading || activePath !== null) return;
    if (skipDailyNoteRef.current) {
      skipDailyNoteRef.current = false;
      return;
    }
    const dailyPath = findDailyNotePath(tree.entries, new Date());
    if (dailyPath !== null) {
      navigate.toPluginPanel(PANEL_PATH, { subPath: dailyPath, replace: true });
    }
  }, [activePath, navigate, tree.entries, tree.isLoading]);

  useEffect(() => {
    let cancelled = false;
    void rpc
      .call("settings", null)
      .then((result) => {
        if (cancelled) return;
        setSettings(result.settings);
        setRoot(result.root);
        const wrap = result.settings["editor.wordWrap"];
        if (wrap !== undefined) setWordWrap(wrap === "on");
      })
      .catch(() => {
        // The imported defaults already cover this; a failed read should not
        // stop the panel from opening.
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  const reload = useCallback(async () => {
    const editor = editorRef.current;
    const autosave = autosaveRef.current;
    if (editor === null || autosave === null || activePath === null) return;
    setIsReloading(true);
    try {
      await autosave.replace(
        async () => {
          const file = await rpc.call("read", { path: activePath });
          if (file.kind !== "text") throw new Error(file.reason);
          return file;
        },
        (content) => editor.setValue(content),
      );
    } catch (error) {
      toast.error(`Could not reload ${activePath}: ${errorText(error)}`);
    } finally {
      setIsReloading(false);
    }
  }, [activePath, rpc]);

  // Boot Monaco and load the open note. Re-runs per note so each gets a
  // fresh model, which is what keeps undo history from leaking between them.
  useEffect(() => {
    setSaveState({ kind: "clean" });
    if (activePath === null) {
      setStatus({ kind: "idle" });
      return;
    }
    const path = activePath;
    let disposed = false;
    let linkOpener: MonacoNs.IDisposable | null = null;
    setStatus({ kind: "loading" });

    void (async () => {
      try {
        await closingNotes.get(path);
        if (disposed) return;
        const [{ baseUrl }, file] = await Promise.all([
          rpc.call("assets", null),
          rpc.call("read", { path }),
        ]);
        if (disposed) return;
        if (file.kind === "unsupported") {
          setStatus({ kind: "unsupported", reason: file.reason });
          return;
        }

        const monaco = await loadMonaco(baseUrl);
        if (disposed) return;
        const container = containerRef.current;
        if (container === null) return;
        monacoRef.current = monaco;

        const applied = applyMarkdownTheme(
          monaco,
          codeThemeRef.current,
          colorOverridesRef.current,
        );
        setOverflowWidgetsTheme(applied.base);

        const editor = monaco.editor.create(container, {
          value: file.content,
          language: "markdown",
          theme: applied.name,
          automaticLayout: true,
          wordWrap: wordWrap ? "on" : "off",
          lineNumbers: settings["editor.lineNumbers"] ?? "on",
          fontSize: settings["editor.fontSize"] ?? 11,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          // Prose, not code: no bracket guides, no occurrence boxes, and a
          // ruler-free gutter keep a note from reading like source.
          renderLineHighlight: "none",
          occurrencesHighlight: "off",
          bracketPairColorization: { enabled: false },
          guides: { indentation: false, bracketPairs: false },
          folding: true,
          lineHeight: 21,
          padding: { top: 12, bottom: 24 },
          quickSuggestions: false,
          // Monaco's word-based suggestions fire mid-sentence while writing
          // prose, which is noise rather than help.
          wordBasedSuggestions: "off",
          unicodeHighlight: { ambiguousCharacters: false },
          fixedOverflowWidgets: true,
          overflowWidgetsDomNode: overflowWidgetsNode(),
        });
        editorRef.current = editor;
        // Cmd/Ctrl+click on a detected link opens it the way the rest of bb
        // opens URLs, instead of Monaco's bare `window.open`.
        linkOpener = monaco.editor.registerLinkOpener({
          open: (resource) => navigateRef.current.openUrl(resource.toString(true)),
        });
        const model = editor.getModel();
        if (model !== null) {
          const autosave: NoteAutosave = new NoteAutosave({
            document: model,
            sha256: file.sha256,
            write: (content, expectedSha256) =>
              rpc.call("write", { path, content, expectedSha256 }),
            onStateChange: (state) => {
              if (autosaveRef.current === autosave) setSaveState(state);
            },
          });
          autosaveRef.current = autosave;
        }
        setStatus({ kind: "ready" });

        const decorations = new DecorationController(monaco, editor);
        decorationsRef.current = decorations;
        decorations.update({
          settings,
          themeType: codeThemeRef.current.theme?.type ?? codeThemeRef.current.mode,
          colors: applied.colors,
          path,
        });

        editor.onDidChangeModelContent(() => {
          autosaveRef.current?.edited();
          decorationsRef.current?.schedule();
        });
        editor.onDidBlurEditorText(() => {
          void autosaveRef.current?.flush();
        });
        editor.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
          () => void autosaveRef.current?.flush(),
        );
      } catch (error) {
        if (disposed) return;
        setStatus({ kind: "error", message: errorText(error) });
      }
    })();

    return () => {
      disposed = true;
      const autosave = detachAutosave();
      if (autosave !== null) {
        const closing = autosave
          .close(true)
          .then((state) => {
            reportUnsavedOnLeave(path, state);
            return state;
          })
          .finally(() => {
            if (closingNotes.get(path) === closing) closingNotes.delete(path);
          });
        closingNotes.set(path, closing);
      }
      linkOpener?.dispose();
      decorationsRef.current?.dispose();
      decorationsRef.current = null;
      editorRef.current?.getModel()?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
    // `settings` and `wordWrap` are read for the initial editor options and
    // applied live by the effects below, so they are deliberately not
    // dependencies: changing them must not tear down the editor and lose the
    // user's cursor and undo stack.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, detachAutosave, rpc]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (monaco === null || editor === null) return;
    const applied = applyMarkdownTheme(monaco, codeTheme, colorOverrides);
    editor.updateOptions({ theme: applied.name });
    setOverflowWidgetsTheme(applied.base);
    if (activePath !== null) {
      decorationsRef.current?.update({
        settings,
        themeType: codeTheme.theme?.type ?? codeTheme.mode,
        colors: applied.colors,
        path: activePath,
      });
    }
  }, [activePath, codeTheme, colorOverrides, settings, status]);

  useEffect(() => {
    editorRef.current?.updateOptions({ wordWrap: wordWrap ? "on" : "off" });
  }, [wordWrap, status]);

  /**
   * Cmd+S outside the editor.
   *
   * Monaco's own binding only fires while the editor has focus, so after
   * clicking a toolbar button the habitual save did nothing and left the
   * note dirty with no feedback. This listener runs on the bubble phase, so
   * a focused editor still handles the key itself and this never
   * double-saves.
   */
  useEffect(() => {
    if (activePath === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "s" || !(event.metaKey || event.ctrlKey)) return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      void autosaveRef.current?.flush();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePath]);

  useEffect(() => {
    const flush = () => void autosaveRef.current?.flush();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  const insertToc = useCallback(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    const model = editor.getModel();
    if (model === null) return;
    const orderedList =
      settings["markdown.extension.toc.orderedList"] === true;

    const current = model.getValue();
    const updated = updateTocBlock(current, { orderedList });
    if (updated.replaced) {
      if (updated.content !== current) {
        editor.pushUndoStop();
        editor.executeEdits("notes-toc", [
          { range: model.getFullModelRange(), text: updated.content },
        ]);
        editor.pushUndoStop();
      }
      toast.success("Table of contents updated");
      return;
    }

    if (collectHeadings(current.split("\n")).length === 0) {
      toast.info("This note has no headings to list");
      return;
    }
    const selection = editor.getSelection();
    if (selection === null) return;
    editor.pushUndoStop();
    editor.executeEdits("notes-toc", [
      { range: selection, text: tocBlock(current, { orderedList }) },
    ]);
    editor.pushUndoStop();
    toast.success(
      orderedList
        ? "Numbered table of contents inserted"
        : "Table of contents inserted",
    );
  }, [settings]);

  useEffect(
    () => () => {
      navigationRef.current += 1;
    },
    [activePath],
  );

  const requestOpen = useCallback(
    async (path: string) => {
      const navigation = ++navigationRef.current;
      if (path === activePath) return;
      const state = await autosaveRef.current?.flush();
      if (navigation !== navigationRef.current) return;
      if (state !== undefined && saveFailed(state)) {
        setPendingNavigation(path);
        return;
      }
      openNote(path);
    },
    [activePath, openNote],
  );

  const create = useCallback(
    async (kind: DraftKind, rawPath: string) => {
      try {
        if (kind === "directory") {
          await rpc.call("createDirectory", { path: rawPath });
          await refreshTree();
          toast.success("Folder created");
          return;
        }
        const path = withMarkdownExtension(rawPath);
        const created = await rpc.call("createFile", { path });
        await refreshTree();
        await requestOpen(created.path);
      } catch (error) {
        toast.error(errorText(error));
      }
    },
    [refreshTree, requestOpen, rpc],
  );

  const rename = useCallback(
    async (from: string, to: string): Promise<string | null> => {
      if (isWithin(activePath, from)) {
        const state = await autosaveRef.current?.flush();
        if (state !== undefined && saveFailed(state)) {
          toast.error("Save or reload the open note before moving it");
          return null;
        }
      }
      try {
        const target = from.includes(".") ? withMarkdownExtension(to) : to;
        const result = await rpc.call("rename", { from, to: target });
        const current = activePathRef.current;
        if (isWithin(current, from)) {
          void detachAutosave()?.close(false);
          openNote(`${result.path}${current.slice(from.length)}`);
        }
        await refreshTree();
        toast.success("Renamed");
        return result.path;
      } catch (error) {
        toast.error(errorText(error));
        return null;
      }
    },
    [activePath, detachAutosave, openNote, refreshTree, rpc],
  );

  const confirmDelete = useCallback(async () => {
    const node = pendingDelete;
    setPendingDelete(null);
    if (node === null) return;
    try {
      await rpc.call("remove", {
        path: node.path,
        recursive: node.kind === "directory",
      });
      if (isWithin(activePathRef.current, node.path)) {
        void detachAutosave()?.close(false);
        skipDailyNoteRef.current = true;
        navigate.toPluginPanel(PANEL_PATH, { subPath: "" });
      }
      await refreshTree();
      toast.success(node.kind === "directory" ? "Folder deleted" : "Note deleted");
    } catch (error) {
      toast.error(errorText(error));
    }
  }, [detachAutosave, navigate, pendingDelete, refreshTree, rpc]);

  const background = editorBackground(codeTheme.theme, colorOverrides);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <NotesToolbar
        path={activePath}
        indicator={indicatorFor(saveState, status)}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
        wordWrap={wordWrap}
        onToggleWordWrap={() => setWordWrap((wrap) => !wrap)}
        onInsertToc={insertToc}
        onReload={() => void reload()}
        isReloading={isReloading}
        canEdit={status.kind === "ready"}
      />

      <Notice
        onOverwrite={() => void autosaveRef.current?.overwrite()}
        onRetry={() => void autosaveRef.current?.flush()}
        onReload={() => void reload()}
        isReloading={isReloading}
        saveState={saveState}
        status={status}
      />

      <div className="flex min-h-0 flex-1">
        {isSidebarOpen ? (
          <div className="flex w-64 shrink-0 flex-col border-r border-border/60 bg-surface-recessed">
            <NotesSidebar
              nodes={nodes}
              activePath={activePath}
              isLoading={tree.isLoading}
              error={tree.error}
              truncated={tree.truncated}
              expandedFoldersKey={expandedFoldersStorageKey(pluginId)}
              onOpen={(path) => void requestOpen(path)}
              onCreate={(kind, path) => void create(kind, path)}
              onRename={rename}
              onDelete={setPendingDelete}
            />
            {root !== "" ? (
              <p
                title={root}
                className="shrink-0 truncate border-t border-border/60 px-3 py-1.5 text-[0.6875rem] text-subtle-foreground"
              >
                {root}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={containerRef}
            className={cn(
              "min-h-0 flex-1",
              status.kind === "ready" ? "" : "pointer-events-none opacity-0",
            )}
            style={background === null ? undefined : { background }}
          />
          {status.kind !== "ready" ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <EmptyState status={status} hasNotes={nodes.length > 0} />
            </div>
          ) : null}
        </div>
      </div>

      <Dialog
        open={pendingNavigation !== null}
        onOpenChange={(open) => {
          if (!open) setPendingNavigation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              {activePath} has changes that could not be saved. Opening
              another note will lose them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingNavigation(null)}
            >
              Keep editing
            </Button>
            <Button
              onClick={() => {
                const next = pendingNavigation;
                setPendingNavigation(null);
                if (next !== null) {
                  void detachAutosave()?.close(false);
                  openNote(next);
                }
              }}
            >
              Discard and open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {pendingDelete?.kind === "directory" ? "folder" : "note"}?
            </DialogTitle>
            <DialogDescription>
              {pendingDelete?.kind === "directory"
                ? `${pendingDelete?.name} and everything inside it will be deleted from disk.`
                : `${pendingDelete?.name} will be deleted from disk.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  status,
  hasNotes,
}: {
  status: EditorStatus;
  hasNotes: boolean;
}) {
  if (status.kind === "loading") {
    return (
      <p className="text-xs text-subtle-foreground">Opening note…</p>
    );
  }
  if (status.kind === "error") {
    return <p className="text-xs text-destructive">{status.message}</p>;
  }
  if (status.kind === "unsupported") {
    return <p className="text-xs text-subtle-foreground">{status.reason}</p>;
  }
  return (
    <p className="max-w-sm text-center text-xs text-subtle-foreground">
      {hasNotes
        ? "Pick a note from the list to start editing."
        : "No notes yet. Use New note in the list to create your first one."}
    </p>
  );
}

function indicatorFor(
  saveState: SaveState,
  status: EditorStatus,
): SaveIndicator {
  if (status.kind === "error") return "error";
  switch (saveState.kind) {
    case "saving":
      return "saving";
    case "dirty":
      return "dirty";
    case "error":
    case "conflict":
      return "error";
    default:
      return "clean";
  }
}

function Notice({
  onOverwrite,
  onRetry,
  onReload,
  isReloading,
  saveState,
  status,
}: {
  onOverwrite: () => void;
  onRetry: () => void;
  onReload: () => void;
  isReloading: boolean;
  saveState: SaveState;
  status: EditorStatus;
}) {
  if (saveState.kind === "conflict") {
    return (
      <NoticeRow tone="error">
        This note changed on disk since you opened it.
        <NoticeAction onClick={onReload} disabled={isReloading}>
          Reload
        </NoticeAction>
        <NoticeAction onClick={onOverwrite}>Overwrite</NoticeAction>
      </NoticeRow>
    );
  }
  if (saveState.kind === "error") {
    return (
      <NoticeRow tone="error">
        Could not save: {saveState.message}
        <NoticeAction onClick={onRetry}>Retry</NoticeAction>
      </NoticeRow>
    );
  }
  if (status.kind === "error") {
    return <NoticeRow tone="error">{status.message}</NoticeRow>;
  }
  return null;
}

function NoticeRow({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "error" | "warning";
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex shrink-0 items-center gap-2 px-4 py-1.5 text-xs",
        tone === "error"
          ? "bg-destructive/10 text-destructive"
          : "bg-surface-recessed text-foreground",
      )}
    >
      {children}
    </div>
  );
}

function NoticeAction({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer rounded-sm font-medium underline underline-offset-2 hover:opacity-80 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "notes",
    title: "Notes",
    icon: "FileText",
    path: PANEL_PATH,
    component: NotesPanel,
  });
});
