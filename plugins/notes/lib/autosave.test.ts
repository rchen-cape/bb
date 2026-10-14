import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteAutosave, type SaveState, type WriteOutcome } from "./autosave.js";

const DELAY = 1000;

class FakeDocument {
  private value: string;
  private version = 1;
  private readonly history: { value: string; version: number }[] = [];
  private nextVersion = 2;
  disposed = false;

  constructor(value: string) {
    this.value = value;
  }

  getValue(): string {
    if (this.disposed) throw new Error("Model is disposed!");
    return this.value;
  }

  getAlternativeVersionId(): number {
    if (this.disposed) throw new Error("Model is disposed!");
    return this.version;
  }

  type(text: string): void {
    this.history.push({ value: this.value, version: this.version });
    this.value += text;
    this.version = this.nextVersion++;
  }

  undo(): void {
    const previous = this.history.pop();
    if (previous === undefined) return;
    this.value = previous.value;
    this.version = previous.version;
  }

  replaceAll(text: string): void {
    this.history.length = 0;
    this.value = text;
    this.version = this.nextVersion++;
  }
}

interface PendingCall {
  content: string;
  expectedSha256: string | null;
  resolve: (outcome: WriteOutcome) => void;
  reject: (error: Error) => void;
}

function setup(initial = "draft") {
  const document = new FakeDocument(initial);
  const calls: PendingCall[] = [];
  const states: SaveState["kind"][] = [];
  const autosave = new NoteAutosave({
    document,
    sha256: "sha-read",
    delayMs: DELAY,
    retryDelaysMs: [2000, 4000],
    write: (content, expectedSha256) =>
      new Promise<WriteOutcome>((resolve, reject) => {
        calls.push({ content, expectedSha256, resolve, reject });
      }),
    onStateChange: (state) => states.push(state.kind),
  });
  const edit = (text: string) => {
    document.type(text);
    autosave.edited();
  };
  return { autosave, calls, document, edit, states };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NoteAutosave", () => {
  it("writes once typing pauses, chaining each save on the last one's hash", async () => {
    const { autosave, calls, edit } = setup();

    edit(" one");
    await vi.advanceTimersByTimeAsync(DELAY - 1);
    edit(" two");
    await vi.advanceTimersByTimeAsync(DELAY - 1);
    expect(calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      content: "draft one two",
      expectedSha256: "sha-read",
    });
    calls[0]!.resolve({ outcome: "written", sha256: "sha-1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.current.kind).toBe("clean");

    edit(" three");
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(calls[1]).toMatchObject({
      content: "draft one two three",
      expectedSha256: "sha-1",
    });
  });

  it("keeps text typed during a save dirty and sends it in the next write", async () => {
    const { autosave, calls, edit } = setup();

    edit(" one");
    await vi.advanceTimersByTimeAsync(DELAY);
    edit(" two");
    calls[0]!.resolve({ outcome: "written", sha256: "sha-1" });
    await vi.advanceTimersByTimeAsync(0);

    expect(autosave.current.kind).toBe("dirty");
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      content: "draft one two",
      expectedSha256: "sha-1",
    });
  });

  it("never runs two writes at once, even when flushed mid-save", async () => {
    const { autosave, calls, edit } = setup();

    edit(" one");
    const first = autosave.flush();
    edit(" two");
    const second = autosave.flush();
    expect(calls).toHaveLength(1);

    calls[0]!.resolve({ outcome: "written", sha256: "sha-1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.expectedSha256).toBe("sha-1");
    calls[1]!.resolve({ outcome: "written", sha256: "sha-2" });

    await expect(first).resolves.toEqual({ kind: "clean" });
    await expect(second).resolves.toEqual({ kind: "clean" });
  });

  it("treats undoing back to the saved text as clean without writing", async () => {
    const { autosave, calls, document, edit } = setup();

    edit(" typo");
    expect(autosave.current.kind).toBe("dirty");
    document.undo();
    autosave.edited();

    expect(autosave.current.kind).toBe("clean");
    await vi.advanceTimersByTimeAsync(DELAY * 5);
    expect(calls).toHaveLength(0);
  });

  it("stops on a conflict and overwrites against the hash on disk", async () => {
    const { autosave, calls, edit } = setup();

    edit(" mine");
    await vi.advanceTimersByTimeAsync(DELAY);
    calls[0]!.resolve({ outcome: "conflict", currentSha256: "sha-theirs" });
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.current.kind).toBe("conflict");

    edit(" more");
    await autosave.flush();
    await vi.advanceTimersByTimeAsync(DELAY * 5);
    expect(calls).toHaveLength(1);

    const overwritten = autosave.overwrite();
    expect(calls[1]).toMatchObject({
      content: "draft mine more",
      expectedSha256: "sha-theirs",
    });
    calls[1]!.resolve({ outcome: "written", sha256: "sha-2" });
    await expect(overwritten).resolves.toEqual({ kind: "clean" });

    edit(" again");
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(calls[2]!.expectedSha256).toBe("sha-2");
  });

  it("recreates a note deleted underneath it when overwriting", async () => {
    const { autosave, calls, edit } = setup();

    edit(" mine");
    await vi.advanceTimersByTimeAsync(DELAY);
    calls[0]!.resolve({ outcome: "conflict", currentSha256: null });
    await vi.advanceTimersByTimeAsync(0);

    void autosave.overwrite();
    expect(calls[1]!.expectedSha256).toBeNull();
  });

  it("retries a failed write on a backoff until it lands", async () => {
    const { autosave, calls, edit } = setup();

    edit(" one");
    await vi.advanceTimersByTimeAsync(DELAY);
    calls[0]!.reject(new Error("host offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.current).toEqual({
      kind: "error",
      message: "host offline",
    });

    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    calls[1]!.reject(new Error("host offline"));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(3999);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls[2]!.expectedSha256).toBe("sha-read");
    calls[2]!.resolve({ outcome: "written", sha256: "sha-1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.current.kind).toBe("clean");
  });

  it("keeps reporting the error while a retry is in flight", async () => {
    const { autosave, calls, edit, states } = setup();

    edit(" one");
    await vi.advanceTimersByTimeAsync(DELAY);
    calls[0]!.reject(new Error("host offline"));
    await vi.advanceTimersByTimeAsync(0);
    states.length = 0;

    edit(" two");
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(2);
    calls[1]!.reject(new Error("host offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([]);

    void autosave.flush();
    calls[2]!.resolve({ outcome: "written", sha256: "sha-1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual(["saving", "clean"]);
  });

  it("keeps overwriting after an overwrite fails, instead of reporting clean", async () => {
    const { autosave, calls, document, edit } = setup();

    edit(" mine");
    await vi.advanceTimersByTimeAsync(DELAY);
    calls[0]!.resolve({ outcome: "conflict", currentSha256: "sha-theirs" });
    await vi.advanceTimersByTimeAsync(0);
    void autosave.overwrite();
    calls[1]!.reject(new Error("host offline"));
    await vi.advanceTimersByTimeAsync(0);

    document.undo();
    autosave.edited();
    expect(autosave.current.kind).toBe("error");

    void autosave.flush();
    expect(calls[2]).toMatchObject({
      content: "draft",
      expectedSha256: "sha-theirs",
    });
  });

  it("saves the last text on close even after the model is disposed", async () => {
    const { autosave, calls, document, edit } = setup();

    edit(" one");
    await vi.advanceTimersByTimeAsync(DELAY);
    edit(" two");
    const closed = autosave.close(true);
    document.disposed = true;

    calls[0]!.resolve({ outcome: "written", sha256: "sha-1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls[1]).toMatchObject({
      content: "draft one two",
      expectedSha256: "sha-1",
    });
    calls[1]!.resolve({ outcome: "written", sha256: "sha-2" });
    await expect(closed).resolves.toEqual({ kind: "clean" });

    await vi.advanceTimersByTimeAsync(DELAY * 5);
    expect(calls).toHaveLength(2);
  });

  it("drops unsaved text when closed without saving", async () => {
    const { autosave, calls, edit } = setup();

    edit(" doomed");
    await autosave.close(false);
    await vi.advanceTimersByTimeAsync(DELAY * 5);

    expect(calls).toHaveLength(0);
  });

  it("holds autosave while reloading so old text cannot overwrite the reload", async () => {
    const { autosave, calls, document, edit } = setup();

    edit(" stale");
    let finishLoad: (file: {
      content: string;
      sha256: string;
    }) => void = () => {};
    const replaced = autosave.replace(
      () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
      (content) => {
        document.replaceAll(content);
        autosave.edited();
      },
    );
    edit(" more");
    await vi.advanceTimersByTimeAsync(DELAY * 5);
    expect(calls).toHaveLength(0);

    finishLoad({ content: "from disk", sha256: "sha-disk" });
    await replaced;
    expect(autosave.current.kind).toBe("clean");

    edit("!");
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(calls[0]).toMatchObject({
      content: "from disk!",
      expectedSha256: "sha-disk",
    });
  });
});
