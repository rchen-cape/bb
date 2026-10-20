import os from "node:os";
import path from "node:path";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const NOTES_ROOT = "/tmp/notes-under-test";

interface FileStubs {
  read?: ReturnType<typeof vi.fn>;
  listPaths?: ReturnType<typeof vi.fn>;
  write?: ReturnType<typeof vi.fn>;
  mkdir?: ReturnType<typeof vi.fn>;
  move?: ReturnType<typeof vi.fn>;
  remove?: ReturnType<typeof vi.fn>;
}

async function setup(
  overrides: FileStubs = {},
  rootDirectory = NOTES_ROOT,
  wikiTagsFile?: string,
) {
  const files = {
    read:
      overrides.read ??
      vi.fn(() => ({
        content: "# Today\n\n#PRIORITY ship it\n",
        contentEncoding: "utf8",
        sizeBytes: 32,
        sha256: "original",
      })),
    listPaths:
      overrides.listPaths ??
      vi.fn(() => ({
        paths: [
          { path: "work", kind: "directory" },
          { path: "work/plan.md", kind: "file" },
          { path: "image.png", kind: "file" },
        ],
        truncated: false,
      })),
    write: overrides.write ?? vi.fn(() => ({ outcome: "written", sha256: "new" })),
    mkdir: overrides.mkdir ?? vi.fn(() => ({ ok: true })),
    move: overrides.move ?? vi.fn(() => ({ ok: true })),
    remove: overrides.remove ?? vi.fn(() => ({ ok: true })),
  };
  const { bb, harness } = createFakePluginHost({
    pluginId: "notes",
    settings:
      wikiTagsFile === undefined
        ? { rootDirectory }
        : { rootDirectory, wikiTagsFile },
    sdk: {
      system: { config: () => ({ dataDir: "/server-data" }) },
      files,
    },
  });
  await plugin(bb);
  return { harness, files };
}

describe("reading notes", () => {
  it("resolves a relative path against the notes root", async () => {
    const { harness, files } = await setup();
    const result = await harness.callRpc("read", { path: "work/plan.md" });
    expect(files.read).toHaveBeenCalledWith({
      path: path.join(NOTES_ROOT, "work/plan.md"),
      rootPath: NOTES_ROOT,
    });
    expect(result).toMatchObject({ kind: "text", path: "work/plan.md" });
  });

  it("refuses to open a non-Markdown file without touching the disk", async () => {
    const { harness, files } = await setup();
    const result = await harness.callRpc("read", { path: "secrets.env" });
    expect(result).toMatchObject({ kind: "unsupported" });
    expect(files.read).not.toHaveBeenCalled();
  });

  it("refuses a path that escapes the notes root", async () => {
    const { harness, files } = await setup();
    await expect(
      harness.callRpc("read", { path: "../.ssh/id_rsa.md" }),
    ).rejects.toThrow(/outside the notes folder/);
    expect(files.read).not.toHaveBeenCalled();
  });

  it("rejects an absolute path at the schema boundary", async () => {
    const { harness } = await setup();
    await expect(
      harness.callRpc("read", { path: "/etc/passwd.md" }),
    ).rejects.toThrow();
  });

  it("reports a binary file as unsupported", async () => {
    const { harness } = await setup({
      read: vi.fn(() => ({
        content: "",
        contentEncoding: "base64",
        sizeBytes: 10,
        sha256: "x",
      })),
    });
    const result = await harness.callRpc("read", { path: "a.md" });
    expect(result).toMatchObject({ kind: "unsupported", reason: /not text/ });
  });

  it("reports an oversized note as unsupported rather than loading it", async () => {
    const { harness } = await setup({
      read: vi.fn(() => ({
        content: "x",
        contentEncoding: "utf8",
        sizeBytes: 9 * 1024 * 1024,
        sha256: "x",
      })),
    });
    const result = await harness.callRpc("read", { path: "big.md" });
    expect(result).toMatchObject({ kind: "unsupported", reason: /too large/ });
  });
});

describe("listing notes", () => {
  it("lists the root without hidden files", async () => {
    const { harness, files } = await setup();
    const result = await harness.callRpc("tree", null);
    expect(files.listPaths).toHaveBeenCalledWith({
      path: NOTES_ROOT,
      includeFiles: true,
      includeDirectories: true,
      includeHidden: false,
      limit: 10_000,
    });
    expect(result.root).toBe(NOTES_ROOT);
    // Filtering to Markdown happens in the panel, so the raw listing is
    // passed through intact.
    expect(result.entries).toHaveLength(3);
  });

  it("creates the notes folder if it is missing", async () => {
    const { harness, files } = await setup();
    await harness.callRpc("tree", null);
    expect(files.mkdir).toHaveBeenCalledWith({
      path: NOTES_ROOT,
      recursive: true,
    });
  });

  it("honours the configured rootDirectory setting", async () => {
    const { harness } = await setup({}, "/srv/vault");
    const result = await harness.callRpc("tree", null);
    expect(result.root).toBe("/srv/vault");
  });

  it("refuses a relative rootDirectory rather than guessing a folder", async () => {
    const { harness } = await setup({}, "notes");
    await expect(harness.callRpc("tree", null)).rejects.toThrow(
      /absolute path or start with/,
    );
  });
});

describe("writing notes", () => {
  it("passes the expected hash through for compare-and-swap", async () => {
    const { harness, files } = await setup();
    await harness.callRpc("write", {
      path: "work/plan.md",
      content: "updated",
      expectedSha256: "original",
    });
    expect(files.write).toHaveBeenCalledWith({
      path: path.join(NOTES_ROOT, "work/plan.md"),
      rootPath: NOTES_ROOT,
      content: "updated",
      contentEncoding: "utf8",
      createParents: true,
      expectedSha256: "original",
    });
  });

  it("surfaces a conflict rather than overwriting", async () => {
    const { harness } = await setup({
      write: vi.fn(() => ({ outcome: "conflict", currentSha256: "theirs" })),
    });
    const result = await harness.callRpc("write", {
      path: "a.md",
      content: "mine",
      expectedSha256: "original",
    });
    expect(result).toEqual({ outcome: "conflict", currentSha256: "theirs" });
  });

  it("refuses to write a non-Markdown path", async () => {
    const { harness, files } = await setup();
    await expect(
      harness.callRpc("write", {
        path: "config.json",
        content: "{}",
        expectedSha256: null,
      }),
    ).rejects.toThrow(/only writes Markdown/);
    expect(files.write).not.toHaveBeenCalled();
  });
});

describe("bb notes write", () => {
  function disk(initialSha256: string | null) {
    let current = initialSha256;
    return vi.fn((args: { expectedSha256: string | null }) => {
      if (args.expectedSha256 !== current) {
        return { outcome: "conflict", currentSha256: current };
      }
      current = "written";
      return { outcome: "written", sha256: current };
    });
  }

  it("overwrites a note that already exists", async () => {
    const write = disk("original");
    const { harness } = await setup({ write });

    const result = await harness.runCli([
      "write",
      "work/plan.md",
      "--content",
      "replaced",
    ]);

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "Wrote work/plan.md\n",
    });
    expect(write).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: "replaced",
        expectedSha256: "original",
      }),
    );
  });

  it("creates a missing note in a single write", async () => {
    const write = disk(null);
    const { harness } = await setup({ write });

    const result = await harness.runCli(["write", "new.md", "--content", "hi"]);

    expect(result.exitCode).toBe(0);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSha256: null }),
    );
  });

  it("fails rather than clobbering a change made mid-write", async () => {
    const write = vi.fn(() => ({
      outcome: "conflict",
      currentSha256: "moving",
    }));
    const { harness } = await setup({ write });

    const result = await harness.runCli(["write", "a.md", "--content", "x"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/changed on disk/);
    expect(write).toHaveBeenCalledTimes(2);
  });
});

describe("creating notes", () => {
  it("refuses to clobber an existing note", async () => {
    const { harness } = await setup({
      write: vi.fn(() => ({ outcome: "conflict", currentSha256: "original" })),
    });
    await expect(
      harness.callRpc("createFile", { path: "work/plan.md" }),
    ).rejects.toThrow(/already exists/);
  });

  it("creates the note with a create-only write", async () => {
    const { harness, files } = await setup();
    const result = await harness.callRpc("createFile", { path: "fresh.md" });
    expect(result).toEqual({ path: "fresh.md", sha256: "new" });
    expect(files.write).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "",
        createParents: true,
        expectedSha256: null,
      }),
    );
  });

  it("requires a Markdown extension", async () => {
    const { harness } = await setup({
      read: vi.fn(() => {
        throw new Error("ENOENT");
      }),
    });
    await expect(
      harness.callRpc("createFile", { path: "notes.txt" }),
    ).rejects.toThrow(/Markdown extension/);
  });
});

describe("folders, renames and deletes", () => {
  it("creates a folder under the root", async () => {
    const { harness, files } = await setup();
    const result = await harness.callRpc("createDirectory", { path: "ideas" });
    expect(files.mkdir).toHaveBeenCalledWith({
      path: path.join(NOTES_ROOT, "ideas"),
      rootPath: NOTES_ROOT,
      recursive: true,
    });
    expect(result).toEqual({ path: "ideas" });
  });

  it("moves within the root", async () => {
    const { harness, files } = await setup();
    const result = await harness.callRpc("rename", {
      from: "a.md",
      to: "work/b.md",
    });
    expect(files.move).toHaveBeenCalledWith({
      sourcePath: path.join(NOTES_ROOT, "a.md"),
      destinationPath: path.join(NOTES_ROOT, "work/b.md"),
      rootPath: NOTES_ROOT,
    });
    expect(result).toEqual({ path: "work/b.md" });
  });

  it("refuses a rename whose destination escapes the root", async () => {
    const { harness, files } = await setup();
    await expect(
      harness.callRpc("rename", { from: "a.md", to: "../../evil.md" }),
    ).rejects.toThrow(/outside the notes folder/);
    expect(files.move).not.toHaveBeenCalled();
  });

  it("removes a note", async () => {
    const { harness, files } = await setup();
    await harness.callRpc("remove", { path: "a.md", recursive: false });
    expect(files.remove).toHaveBeenCalledWith({
      path: path.join(NOTES_ROOT, "a.md"),
      rootPath: NOTES_ROOT,
      recursive: false,
    });
  });

  it("refuses to delete the notes folder itself", async () => {
    const { harness, files } = await setup();
    await expect(
      harness.callRpc("remove", { path: ".", recursive: true }),
    ).rejects.toThrow(/cannot be deleted/);
    expect(files.remove).not.toHaveBeenCalled();
  });
});

describe("settings", () => {
  it("falls back to the imported VS Code defaults when there is no override", async () => {
    const { harness } = await setup({
      read: vi.fn(() => {
        throw new Error("ENOENT");
      }),
    });
    const result = await harness.callRpc("settings", null);
    expect(result.overridePath).toBeNull();
    expect(
      Object.keys(result.settings["highlight.regexes"] ?? {}),
    ).toHaveLength(7);
    expect(result.settings["markdown.extension.toc.orderedList"]).toBe(true);
  });

  it("merges a .vscode/settings.json override over the defaults", async () => {
    const { harness, files } = await setup({
      read: vi.fn(() => ({
        content: '{"editor.fontSize": 15 // bigger\n}',
        contentEncoding: "utf8",
        sizeBytes: 30,
        sha256: "s",
      })),
    });
    const result = await harness.callRpc("settings", null);
    expect(files.read).toHaveBeenCalledWith({
      path: path.join(NOTES_ROOT, ".vscode/settings.json"),
      rootPath: NOTES_ROOT,
    });
    expect(result.overridePath).toBe(".vscode/settings.json");
    expect(result.settings["editor.fontSize"]).toBe(15);
    // The override said nothing about highlighting, so the import survives.
    expect(
      Object.keys(result.settings["highlight.regexes"] ?? {}),
    ).toHaveLength(7);
  });

  it("ignores a malformed override instead of failing the panel", async () => {
    const { harness } = await setup({
      read: vi.fn(() => ({
        content: "{ this is not json",
        contentEncoding: "utf8",
        sizeBytes: 10,
        sha256: "s",
      })),
    });
    const result = await harness.callRpc("settings", null);
    expect(result.overridePath).toBeNull();
    expect(result.settings["markdown.extension.toc.orderedList"]).toBe(true);
  });
});

describe("wiki tags", () => {
  const MTIME_SECONDS = 1_700_000_000;
  let dir = "";
  let tagsPath = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "notes-wiki-tags-"));
    tagsPath = path.join(dir, "tags.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeTags(file: string, tags: string[], mtimeSeconds: number) {
    const docs = tags.map((tag) => ({ tag, title: tag, type: "topic" }));
    writeFileSync(file, JSON.stringify({ version: 1, docs }));
    utimesSync(file, mtimeSeconds, mtimeSeconds);
  }

  it("is off when the setting is unset or blank", async () => {
    const unset = await setup();
    await expect(
      unset.harness.callRpc("wikiTags", { knownMtimeMs: null }),
    ).resolves.toEqual({ status: "off" });

    const blank = await setup({}, NOTES_ROOT, "  ");
    await expect(
      blank.harness.callRpc("wikiTags", { knownMtimeMs: null }),
    ).resolves.toEqual({ status: "off" });
  });

  it("reports a file that does not exist", async () => {
    const { harness } = await setup(
      {},
      NOTES_ROOT,
      path.join(dir, "absent.json"),
    );
    await expect(
      harness.callRpc("wikiTags", { knownMtimeMs: null }),
    ).resolves.toEqual({ status: "missing" });
  });

  it("reports a folder in place of the file as missing", async () => {
    const { harness } = await setup({}, NOTES_ROOT, dir);
    await expect(
      harness.callRpc("wikiTags", { knownMtimeMs: null }),
    ).resolves.toEqual({ status: "missing" });
  });

  it("reports a file that is not a valid tags.json", async () => {
    writeFileSync(tagsPath, '{ "version": 1, "docs": [');
    const { harness } = await setup({}, NOTES_ROOT, tagsPath);
    await expect(
      harness.callRpc("wikiTags", { knownMtimeMs: null }),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("returns the tags with the file's mtime", async () => {
    writeTags(tagsPath, ["alpha", "beta"], MTIME_SECONDS);
    const { harness } = await setup({}, NOTES_ROOT, tagsPath);
    const result = await harness.callRpc("wikiTags", { knownMtimeMs: null });
    expect(result).toEqual({
      status: "ok",
      mtimeMs: MTIME_SECONDS * 1000,
      tags: [
        { tag: "alpha", title: "alpha", type: "topic", aliases: [] },
        { tag: "beta", title: "beta", type: "topic", aliases: [] },
      ],
    });
  });

  it("answers unchanged when the caller already has this version", async () => {
    writeTags(tagsPath, ["alpha"], MTIME_SECONDS);
    const { harness } = await setup({}, NOTES_ROOT, tagsPath);
    await expect(
      harness.callRpc("wikiTags", { knownMtimeMs: MTIME_SECONDS * 1000 }),
    ).resolves.toEqual({ status: "unchanged" });
  });

  it("reads the file again only when its mtime or size changes", async () => {
    writeTags(tagsPath, ["alpha"], MTIME_SECONDS);
    const { harness } = await setup({}, NOTES_ROOT, tagsPath);
    await harness.callRpc("wikiTags", { knownMtimeMs: null });

    writeTags(tagsPath, ["gamma"], MTIME_SECONDS);
    const cached = await harness.callRpc("wikiTags", { knownMtimeMs: null });
    expect(cached).toMatchObject({ status: "ok", tags: [{ tag: "alpha" }] });

    writeTags(tagsPath, ["gamma"], MTIME_SECONDS + 1);
    const changed = await harness.callRpc("wikiTags", {
      knownMtimeMs: MTIME_SECONDS * 1000,
    });
    expect(changed).toMatchObject({
      status: "ok",
      mtimeMs: (MTIME_SECONDS + 1) * 1000,
      tags: [{ tag: "gamma" }],
    });
  });

  it("picks up a tags file that appears after it was missing", async () => {
    const { harness } = await setup({}, NOTES_ROOT, tagsPath);
    await expect(
      harness.callRpc("wikiTags", { knownMtimeMs: null }),
    ).resolves.toEqual({ status: "missing" });

    writeTags(tagsPath, ["alpha"], MTIME_SECONDS);

    await expect(
      harness.callRpc("wikiTags", { knownMtimeMs: null }),
    ).resolves.toMatchObject({ status: "ok", tags: [{ tag: "alpha" }] });
  });

  it.skipIf(process.getuid?.() === 0)(
    "reads the file again after a read error, even when its mtime is unchanged",
    async () => {
      writeTags(tagsPath, ["alpha"], MTIME_SECONDS);
      chmodSync(tagsPath, 0o000);
      const { harness } = await setup({}, NOTES_ROOT, tagsPath);
      await expect(
        harness.callRpc("wikiTags", { knownMtimeMs: null }),
      ).resolves.toEqual({ status: "invalid" });

      chmodSync(tagsPath, 0o644);

      await expect(
        harness.callRpc("wikiTags", { knownMtimeMs: null }),
      ).resolves.toMatchObject({
        status: "ok",
        mtimeMs: MTIME_SECONDS * 1000,
        tags: [{ tag: "alpha" }],
      });
    },
  );

  it("refuses a tags file too large to be one the Wiki wrote", async () => {
    const valid = JSON.stringify({ version: 1, docs: [{ tag: "alpha" }] });
    writeFileSync(tagsPath, valid + " ".repeat(4 * 1024 * 1024));
    const { harness } = await setup({}, NOTES_ROOT, tagsPath);
    await expect(
      harness.callRpc("wikiTags", { knownMtimeMs: null }),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("follows a settings change without a restart", async () => {
    const otherPath = path.join(dir, "other.json");
    writeTags(tagsPath, ["alpha"], MTIME_SECONDS);
    writeTags(otherPath, ["beta"], MTIME_SECONDS);
    const { harness } = await setup({}, NOTES_ROOT, tagsPath);
    await harness.callRpc("wikiTags", { knownMtimeMs: null });

    await harness.setSettings({ wikiTagsFile: otherPath });

    await expect(
      harness.callRpc("wikiTags", { knownMtimeMs: null }),
    ).resolves.toMatchObject({ status: "ok", tags: [{ tag: "beta" }] });
  });

  it("refuses a relative path in the setting", async () => {
    const { harness } = await setup();
    await expect(
      harness.setSettings({ wikiTagsFile: "Wiki/.wiki/tags.json" }),
    ).rejects.toThrow(/absolute path/);
  });

  it("shows the tags file in bb notes settings", async () => {
    writeTags(tagsPath, ["alpha"], MTIME_SECONDS);
    const configured = await setup({}, NOTES_ROOT, tagsPath);
    const text = await configured.harness.runCli(["settings"]);
    expect(text.stdout).toContain(`Wiki tags:       ${tagsPath} (1 doc)`);

    const json = await configured.harness.runCli(["settings", "--json"]);
    expect(JSON.parse(json.stdout ?? "").wikiTags).toEqual({
      path: tagsPath,
      status: "ok",
      docCount: 1,
    });

    const off = await setup();
    const offText = await off.harness.runCli(["settings"]);
    expect(offText.stdout).toContain("Wiki tags:       off");
  });
});
