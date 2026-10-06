import type { WorkspaceOpenTarget } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  resolvePreferredTerminalOpenTarget,
  resolvePreferredWorkspaceOpenFileTarget,
  resolvePreferredWorkspaceOpenTarget,
} from "./workspace-open-target-preference";

const finderTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: false,
    openFileAtLine: false,
  },
  id: "finder",
  kind: "file-manager",
  label: "Finder",
};

const terminalTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: false,
    openFileAtLine: false,
  },
  id: "terminal",
  kind: "terminal",
  label: "Terminal",
};

const vscodeTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: true,
  },
  id: "vscode",
  kind: "editor",
  label: "VS Code",
};

const defaultAppTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: false,
  },
  id: "default-app",
  kind: "default-app",
  label: "Default App",
};

describe("resolvePreferredWorkspaceOpenTarget", () => {
  it("chooses the stored target when it supports the requested capability", () => {
    expect(
      resolvePreferredWorkspaceOpenTarget({
        capability: "openDirectory",
        preferredTargetId: "finder",
        targets: [vscodeTarget, finderTarget],
      }),
    ).toBe(finderTarget);
  });

  it("falls back to the first target with the requested capability", () => {
    expect(
      resolvePreferredWorkspaceOpenTarget({
        capability: "openFile",
        preferredTargetId: null,
        targets: [finderTarget, defaultAppTarget, vscodeTarget],
      }),
    ).toBe(defaultAppTarget);
  });

  it("ignores stored targets that do not support the requested capability", () => {
    expect(
      resolvePreferredWorkspaceOpenTarget({
        capability: "openFile",
        preferredTargetId: "finder",
        targets: [finderTarget, vscodeTarget],
      }),
    ).toBe(vscodeTarget);
  });

  it("returns null when no available target supports the requested capability", () => {
    expect(
      resolvePreferredWorkspaceOpenTarget({
        capability: "openFile",
        preferredTargetId: null,
        targets: [finderTarget, terminalTarget],
      }),
    ).toBeNull();
  });

  it("uses Default App when a stored target is no longer available", () => {
    expect(
      resolvePreferredWorkspaceOpenTarget({
        capability: "openDirectory",
        preferredTargetId: "removed-editor",
        targets: [finderTarget, defaultAppTarget],
      }),
    ).toBe(defaultAppTarget);
  });

  it("uses remote SSH capabilities when resolving remote targets", () => {
    const remoteVscodeTarget: WorkspaceOpenTarget = {
      ...vscodeTarget,
      remoteSshCapabilities: {
        openDirectory: true,
        openFile: true,
        openFileAtLine: true,
      },
    };

    expect(
      resolvePreferredWorkspaceOpenTarget({
        capability: "openFile",
        contextKind: "remote-ssh",
        preferredTargetId: "default-app",
        targets: [defaultAppTarget, remoteVscodeTarget],
      }),
    ).toBe(remoteVscodeTarget);
  });
});

describe("resolvePreferredWorkspaceOpenFileTarget", () => {
  it("respects an explicit stored file target", () => {
    expect(
      resolvePreferredWorkspaceOpenFileTarget({
        path: "/tmp/screenshot.png",
        preferredTargetId: "vscode",
        targets: [defaultAppTarget, vscodeTarget],
      }),
    ).toBe(vscodeTarget);
  });

  it("prefers native/default apps for viewable files when no preference is set", () => {
    expect(
      resolvePreferredWorkspaceOpenFileTarget({
        path: "/tmp/screenshot.png",
        preferredTargetId: null,
        targets: [vscodeTarget, defaultAppTarget],
      }),
    ).toBe(defaultAppTarget);
  });

  it("prefers editors for source files when no preference is set", () => {
    expect(
      resolvePreferredWorkspaceOpenFileTarget({
        path: "/tmp/src/file.ts",
        preferredTargetId: null,
        targets: [defaultAppTarget, terminalTarget, vscodeTarget],
      }),
    ).toBe(vscodeTarget);
  });

  it("uses Default App for source files when a stored target is unavailable", () => {
    expect(
      resolvePreferredWorkspaceOpenFileTarget({
        path: "/tmp/src/file.ts",
        preferredTargetId: "removed-editor",
        targets: [vscodeTarget, defaultAppTarget],
      }),
    ).toBe(defaultAppTarget);
  });

  it("prefers editors for line-targeted opens even when the extension is viewable", () => {
    expect(
      resolvePreferredWorkspaceOpenFileTarget({
        lineNumber: 12,
        path: "/tmp/report.pdf",
        preferredTargetId: null,
        targets: [defaultAppTarget, terminalTarget, vscodeTarget],
      }),
    ).toBe(vscodeTarget);
  });

  it("uses remote SSH capabilities when resolving remote file targets", () => {
    const remoteVscodeTarget: WorkspaceOpenTarget = {
      ...vscodeTarget,
      remoteSshCapabilities: {
        openDirectory: true,
        openFile: true,
        openFileAtLine: true,
      },
    };

    expect(
      resolvePreferredWorkspaceOpenFileTarget({
        contextKind: "remote-ssh",
        path: "/home/me/src/file.ts",
        preferredTargetId: "default-app",
        targets: [defaultAppTarget, remoteVscodeTarget],
      }),
    ).toBe(remoteVscodeTarget);
  });
});

describe("resolvePreferredTerminalOpenTarget", () => {
  it("returns null when no terminal preference is stored", () => {
    expect(
      resolvePreferredTerminalOpenTarget({
        preferredTargetId: null,
        targets: [terminalTarget, vscodeTarget],
      }),
    ).toBeNull();
  });

  it("returns the stored terminal target when it is available", () => {
    expect(
      resolvePreferredTerminalOpenTarget({
        preferredTargetId: "terminal",
        targets: [vscodeTarget, terminalTarget],
      }),
    ).toBe(terminalTarget);
  });

  it("returns null when the stored target is not installed", () => {
    expect(
      resolvePreferredTerminalOpenTarget({
        preferredTargetId: "ghostty",
        targets: [vscodeTarget, terminalTarget],
      }),
    ).toBeNull();
  });

  it("ignores stored targets that are not terminals", () => {
    expect(
      resolvePreferredTerminalOpenTarget({
        preferredTargetId: "vscode",
        targets: [vscodeTarget, terminalTarget],
      }),
    ).toBeNull();
  });

  it("requires remote SSH directory support for remote workspaces", () => {
    const sshTerminal: WorkspaceOpenTarget = {
      ...terminalTarget,
      id: "ghostty",
      label: "Ghostty",
      remoteSshCapabilities: {
        openDirectory: true,
        openFile: true,
        openFileAtLine: true,
      },
    };
    expect(
      resolvePreferredTerminalOpenTarget({
        contextKind: "remote-ssh",
        preferredTargetId: "terminal",
        targets: [terminalTarget, sshTerminal],
      }),
    ).toBeNull();
    expect(
      resolvePreferredTerminalOpenTarget({
        contextKind: "remote-ssh",
        preferredTargetId: "ghostty",
        targets: [terminalTarget, sshTerminal],
      }),
    ).toBe(sshTerminal);
  });
});
