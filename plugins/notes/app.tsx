import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_useCodeTheme,
  experimental_usePluginId,
  useBbNavigate,
  useRpc,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
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
import {
  createNoteEditor,
  type NoteEditor,
  type NoteEditorConfig,
} from "./lib/note-editor.js";
import { refreshWikiTags } from "./lib/wiki-completion.js";
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

const TOC_TOASTS = {
  updated: () => toast.success("Table of contents updated"),
  "no-headings": () => toast.info("This note has no headings to list"),
} as const;

function NotesPanel({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const codeTheme = experimental_useCodeTheme();
  const pluginId = experimental_usePluginId();

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<NoteEditor | null>(null);
  const autosaveRef = useRef<NoteAutosave | null>(null);
  const navigationRef = useRef(0);

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

  const editorConfig = useMemo<NoteEditorConfig>(
    () => ({
      settings,
      codeTheme: { mode: codeTheme.mode, theme: codeTheme.theme },
      wordWrap,
    }),
    [codeTheme.mode, codeTheme.theme, settings, wordWrap],
  );
  const editorConfigRef = useRef(editorConfig);
  useEffect(() => {
    editorConfigRef.current = editorConfig;
  }, [editorConfig]);

  const detachAutosave = useCallback((): NoteAutosave | null => {
    const autosave = autosaveRef.current;
    autosaveRef.current = null;
    return autosave;
  }, []);

  const nodes = useMemo(() => buildTree(tree.entries), [tree.entries]);
  const entriesRef = useRef<readonly FlatEntry[]>([]);
  useEffect(() => {
    entriesRef.current = tree.entries;
  }, [tree.entries]);
  const requestOpenRef = useRef<(path: string) => Promise<void>>(
    async () => undefined,
  );

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
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  useEffect(() => {
    void refreshWikiTags(rpc);
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
        (content) => editor.replaceContent(content),
      );
    } catch (error) {
      toast.error(`Could not reload ${activePath}: ${errorText(error)}`);
    } finally {
      setIsReloading(false);
    }
  }, [activePath, rpc]);

  useEffect(() => {
    setSaveState({ kind: "clean" });
    if (activePath === null) {
      setStatus({ kind: "idle" });
      return;
    }
    const path = activePath;
    let disposed = false;
    setStatus({ kind: "loading" });

    void (async () => {
      try {
        await closingNotes.get(path);
        if (disposed) return;
        const file = await rpc.call("read", { path });
        if (disposed) return;
        if (file.kind === "unsupported") {
          setStatus({ kind: "unsupported", reason: file.reason });
          return;
        }
        const container = containerRef.current;
        if (container === null) return;

        const editor = createNoteEditor({
          parent: container,
          path,
          content: file.content,
          config: editorConfigRef.current,
          wikiTags: rpc,
          handlers: {
            onChange: () => autosaveRef.current?.edited(),
            onBlur: () => void autosaveRef.current?.flush(),
            onFocus: () => void refreshWikiTags(rpc),
            onSave: () => void autosaveRef.current?.flush(),
            openUrl: (href) => navigateRef.current.openUrl(href),
            openNote: (target) => {
              const known = entriesRef.current.some(
                (entry) => entry.kind === "file" && entry.path === target,
              );
              if (known) void requestOpenRef.current(target);
              return known;
            },
          },
        });
        editorRef.current = editor;
        const autosave: NoteAutosave = new NoteAutosave({
          document: editor.document,
          sha256: file.sha256,
          write: (content, expectedSha256) =>
            rpc.call("write", { path, content, expectedSha256 }),
          onStateChange: (state) => {
            if (autosaveRef.current === autosave) setSaveState(state);
          },
        });
        autosaveRef.current = autosave;
        setStatus({ kind: "ready" });
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
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, [activePath, detachAutosave, rpc]);

  useEffect(() => {
    editorRef.current?.configure(editorConfig);
  }, [editorConfig, status]);

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
    const orderedList =
      settings["markdown.extension.toc.orderedList"] === true;
    const outcome = editor.insertToc(orderedList);
    if (outcome === "inserted") {
      toast.success(
        orderedList
          ? "Numbered table of contents inserted"
          : "Table of contents inserted",
      );
      return;
    }
    TOC_TOASTS[outcome]();
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
  useEffect(() => {
    requestOpenRef.current = requestOpen;
  }, [requestOpen]);

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
              "flex min-h-0 flex-1 flex-col",
              status.kind === "ready" ? "" : "pointer-events-none opacity-0",
            )}
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
