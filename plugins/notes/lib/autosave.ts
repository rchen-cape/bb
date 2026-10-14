export type SaveState =
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "conflict" };

export type WriteOutcome =
  | { outcome: "written"; sha256: string }
  | { outcome: "conflict"; currentSha256: string | null };

export interface AutosaveDocument {
  getValue(): string;
  getAlternativeVersionId(): number;
}

export interface NoteAutosaveOptions {
  document: AutosaveDocument;
  sha256: string;
  write: (
    content: string,
    expectedSha256: string | null,
  ) => Promise<WriteOutcome>;
  onStateChange: (state: SaveState) => void;
  delayMs?: number;
  retryDelaysMs?: readonly number[];
}

export const AUTOSAVE_DELAY_MS = 1000;
const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];

interface PendingWrite {
  content: string;
  version: number;
  overwrite: boolean;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class NoteAutosave {
  private document: AutosaveDocument;
  private sha256: string;
  private conflictSha256: string | null = null;
  private savedVersion: number;
  private state: SaveState = { kind: "clean" };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: PendingWrite | null = null;
  private running: Promise<void> | null = null;
  private failures = 0;
  private overwriting = false;
  private replacing = false;
  private closed = false;
  private readonly write: NoteAutosaveOptions["write"];
  private readonly onStateChange: NoteAutosaveOptions["onStateChange"];
  private readonly delayMs: number;
  private readonly retryDelaysMs: readonly number[];

  constructor(options: NoteAutosaveOptions) {
    this.document = options.document;
    this.sha256 = options.sha256;
    this.savedVersion = options.document.getAlternativeVersionId();
    this.write = options.write;
    this.onStateChange = options.onStateChange;
    this.delayMs = options.delayMs ?? AUTOSAVE_DELAY_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  }

  get current(): SaveState {
    return this.state;
  }

  edited(): void {
    if (this.closed || this.replacing || this.state.kind === "conflict") {
      return;
    }
    if (this.running === null && this.isSaved() && !this.overwriting) {
      this.cancelTimer();
      this.setState({ kind: "clean" });
      return;
    }
    if (this.state.kind === "clean") this.setState({ kind: "dirty" });
    if (this.state.kind === "error" && this.timer !== null) return;
    this.schedule(this.delayMs);
  }

  flush(): Promise<SaveState> {
    if (this.closed || this.replacing) return this.settled();
    return this.enqueue(false);
  }

  overwrite(): Promise<SaveState> {
    if (this.closed || this.replacing) return this.settled();
    if (this.state.kind !== "conflict") return this.enqueue(false);
    return this.enqueue(true);
  }

  async replace(
    load: () => Promise<{ content: string; sha256: string }>,
    apply: (content: string) => void,
  ): Promise<void> {
    if (this.closed || this.replacing) return;
    this.cancelTimer();
    this.pending = null;
    this.replacing = true;
    try {
      await this.running;
      const file = await load();
      if (this.closed) return;
      apply(file.content);
      this.sha256 = file.sha256;
      this.conflictSha256 = null;
      this.overwriting = false;
      this.savedVersion = this.document.getAlternativeVersionId();
      this.failures = 0;
      this.setState({ kind: "clean" });
    } finally {
      this.replacing = false;
      if (!this.closed && this.state.kind !== "conflict" && !this.isSaved()) {
        this.schedule(this.delayMs);
      }
    }
  }

  close(save: boolean): Promise<SaveState> {
    if (this.closed) return this.settled();
    const content = this.document.getValue();
    const version = this.document.getAlternativeVersionId();
    this.document = {
      getValue: () => content,
      getAlternativeVersionId: () => version,
    };
    this.closed = true;
    this.cancelTimer();
    if (!save || this.state.kind === "conflict" || this.replacing) {
      this.pending = null;
      return this.settled();
    }
    return this.enqueue(false);
  }

  private enqueue(requested: boolean): Promise<SaveState> {
    this.cancelTimer();
    const overwrite = requested || this.overwriting;
    const version = this.document.getAlternativeVersionId();
    const isConflict = this.state.kind === "conflict";
    if (isConflict && !overwrite) return this.settled();
    if (!overwrite && this.running === null && version === this.savedVersion) {
      this.setState({ kind: "clean" });
      return this.settled();
    }
    this.pending = {
      content: this.document.getValue(),
      version,
      overwrite: overwrite || (this.pending?.overwrite ?? false),
    };
    this.running ??= this.drain();
    return this.settled();
  }

  private async drain(): Promise<void> {
    while (this.pending !== null) {
      const job = this.pending;
      this.pending = null;
      if (!job.overwrite && job.version === this.savedVersion) continue;
      if (this.state.kind !== "error") this.setState({ kind: "saving" });
      let result: WriteOutcome;
      try {
        result = await this.write(
          job.content,
          job.overwrite ? this.conflictSha256 : this.sha256,
        );
      } catch (error) {
        this.pending = null;
        if (job.overwrite) this.overwriting = true;
        this.failures += 1;
        this.setState({ kind: "error", message: errorText(error) });
        const retry =
          this.retryDelaysMs[
            Math.min(this.failures, this.retryDelaysMs.length) - 1
          ];
        if (retry !== undefined) this.schedule(retry);
        break;
      }
      this.overwriting = false;
      if (result.outcome === "conflict") {
        this.pending = null;
        this.conflictSha256 = result.currentSha256;
        this.setState({ kind: "conflict" });
        break;
      }
      this.failures = 0;
      this.sha256 = result.sha256;
      this.conflictSha256 = null;
      this.savedVersion = job.version;
      if (this.state.kind === "error") this.setState({ kind: "saving" });
    }
    this.running = null;
    if (this.state.kind === "saving") {
      if (this.isSaved()) {
        this.setState({ kind: "clean" });
      } else {
        this.setState({ kind: "dirty" });
        if (this.timer === null) this.schedule(this.delayMs);
      }
    }
  }

  private settled(): Promise<SaveState> {
    return (this.running ?? Promise.resolve()).then(() => this.state);
  }

  private isSaved(): boolean {
    return this.document.getAlternativeVersionId() === this.savedVersion;
  }

  private schedule(delayMs: number): void {
    if (this.closed) return;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private setState(next: SaveState): void {
    if (
      next.kind === this.state.kind &&
      (next.kind !== "error" ||
        (this.state.kind === "error" && this.state.message === next.message))
    ) {
      return;
    }
    this.state = next;
    this.onStateChange(next);
  }
}
