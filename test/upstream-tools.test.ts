import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  saveConfig,
  loadMergeState,
  saveMergeState,
  removeMergeState,
  clearMergeState,
  getSuperDevMergeStatePath,
  getLegacyMergeStatePath,
} from "../src/lib/upstream-tools.js";
import { saveSuperDevConfig, loadSuperDevConfig } from "../src/lib/settings.js";
import type { UpstreamConfig, MergeState } from "../src/types.js";

function createTempProject(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "super-dev-upstream-test-"));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const mockConfig: UpstreamConfig = {
  remote: "upstream",
  branch: "main",
  policies: {
    always_ours: ["package.json"],
    always_theirs: [],
    manual_review: [],
  },
  categories: {
    dependencies: ["package.json"],
  },
};

const mockMergeState: MergeState = {
  branch: "upstream-merge-test",
  previousBranch: "main",
  remote: "upstream",
  remoteBranch: "main",
  startedAt: new Date().toISOString(),
  conflicts: ["foo.txt"],
  allChangedFiles: ["foo.txt", "bar.txt"],
  resolved: {},
  status: "in_progress",
};

test("loadConfig returns null when no configuration files exist", () => {
  const { root, cleanup } = createTempProject();
  try {
    const config = loadConfig(root);
    assert.equal(config, null);
  } finally {
    cleanup();
  }
});

test("loadConfig loads from .super-dev/config.json when upstream key is present", () => {
  const { root, cleanup } = createTempProject();
  try {
    saveSuperDevConfig(root, { upstream: mockConfig });
    const loaded = loadConfig(root);
    assert.deepEqual(loaded, mockConfig);
  } finally {
    cleanup();
  }
});

test("loadConfig falls back to .upstream/config.json when .super-dev/config.json lacks upstream key", () => {
  const { root, cleanup } = createTempProject();
  try {
    // Write .super-dev/config.json with only architecture
    saveSuperDevConfig(root, { architecture: { source: "docs/architecture" } });

    // Write .upstream/config.json
    const upstreamDir = join(root, ".upstream");
    mkdirSync(upstreamDir, { recursive: true });
    writeFileSync(join(upstreamDir, "config.json"), JSON.stringify(mockConfig, null, 2) + "\n");

    const loaded = loadConfig(root);
    assert.deepEqual(loaded, mockConfig);
  } finally {
    cleanup();
  }
});

test("loadConfig falls back to .upstream/config.json when .super-dev does not exist", () => {
  const { root, cleanup } = createTempProject();
  try {
    const upstreamDir = join(root, ".upstream");
    mkdirSync(upstreamDir, { recursive: true });
    writeFileSync(join(upstreamDir, "config.json"), JSON.stringify(mockConfig, null, 2) + "\n");

    const loaded = loadConfig(root);
    assert.deepEqual(loaded, mockConfig);
  } finally {
    cleanup();
  }
});

test("loadConfig prioritizes .super-dev/config.json over .upstream/config.json", () => {
  const { root, cleanup } = createTempProject();
  try {
    const superDevConfig: UpstreamConfig = { ...mockConfig, branch: "superdev-branch" };
    const legacyConfig: UpstreamConfig = { ...mockConfig, branch: "legacy-branch" };

    saveSuperDevConfig(root, { upstream: superDevConfig });

    const upstreamDir = join(root, ".upstream");
    mkdirSync(upstreamDir, { recursive: true });
    writeFileSync(join(upstreamDir, "config.json"), JSON.stringify(legacyConfig, null, 2) + "\n");

    const loaded = loadConfig(root);
    assert.equal(loaded?.branch, "superdev-branch");
  } finally {
    cleanup();
  }
});

test("loadConfig falls back to legacy root .upstream.json and migrates", () => {
  const { root, cleanup } = createTempProject();
  try {
    writeFileSync(join(root, ".upstream.json"), JSON.stringify(mockConfig, null, 2) + "\n");
    const loaded = loadConfig(root);
    assert.deepEqual(loaded, mockConfig);
    // Root file should be migrated (removed)
    assert.equal(existsSync(join(root, ".upstream.json")), false);
  } finally {
    cleanup();
  }
});

test("saveConfig saves to .super-dev/config.json and preserves existing settings", () => {
  const { root, cleanup } = createTempProject();
  try {
    writeFileSync(join(root, ".gitignore"), "node_modules/\n");
    saveSuperDevConfig(root, { architecture: { source: "custom/arch", reference: "CUSTOM.md" } });

    saveConfig(root, mockConfig);

    const superDevConfig = loadSuperDevConfig(root);
    assert.deepEqual(superDevConfig.upstream, mockConfig);
    assert.equal(superDevConfig.architecture?.source, "custom/arch");

    // Check .gitignore was updated
    const gitignoreContent = readFileSync(join(root, ".gitignore"), "utf-8");
    assert.ok(gitignoreContent.includes(".super-dev/"));

    // Legacy .upstream/ directory should not have been created
    assert.equal(existsSync(join(root, ".upstream")), false);
  } finally {
    cleanup();
  }
});

test("saveConfig synchronizes to .upstream/config.json if legacy .upstream/ directory exists", () => {
  const { root, cleanup } = createTempProject();
  try {
    const upstreamDir = join(root, ".upstream");
    mkdirSync(upstreamDir, { recursive: true });

    saveConfig(root, mockConfig);

    // Should be in .super-dev/config.json
    const superDevConfig = loadSuperDevConfig(root);
    assert.deepEqual(superDevConfig.upstream, mockConfig);

    // And synced in .upstream/config.json
    const legacyContent = JSON.parse(readFileSync(join(upstreamDir, "config.json"), "utf-8"));
    assert.deepEqual(legacyContent, mockConfig);
  } finally {
    cleanup();
  }
});

test("loadMergeState returns null when no state exists", () => {
  const { root, cleanup } = createTempProject();
  try {
    assert.equal(loadMergeState(root), null);
  } finally {
    cleanup();
  }
});

test("loadMergeState loads from .super-dev/upstream-merge-state.json", () => {
  const { root, cleanup } = createTempProject();
  try {
    const statePath = getSuperDevMergeStatePath(root);
    mkdirSync(join(root, ".super-dev"), { recursive: true });
    writeFileSync(statePath, JSON.stringify(mockMergeState, null, 2) + "\n");

    const loaded = loadMergeState(root);
    assert.deepEqual(loaded, mockMergeState);
  } finally {
    cleanup();
  }
});

test("loadMergeState falls back to .upstream/merge-state.json", () => {
  const { root, cleanup } = createTempProject();
  try {
    const legacyPath = getLegacyMergeStatePath(root);
    mkdirSync(join(root, ".upstream"), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify(mockMergeState, null, 2) + "\n");

    const loaded = loadMergeState(root);
    assert.deepEqual(loaded, mockMergeState);
  } finally {
    cleanup();
  }
});

test("loadMergeState prioritizes .super-dev over .upstream", () => {
  const { root, cleanup } = createTempProject();
  try {
    const state1: MergeState = { ...mockMergeState, branch: "superdev-merge" };
    const state2: MergeState = { ...mockMergeState, branch: "legacy-merge" };

    mkdirSync(join(root, ".super-dev"), { recursive: true });
    writeFileSync(getSuperDevMergeStatePath(root), JSON.stringify(state1, null, 2) + "\n");

    mkdirSync(join(root, ".upstream"), { recursive: true });
    writeFileSync(getLegacyMergeStatePath(root), JSON.stringify(state2, null, 2) + "\n");

    const loaded = loadMergeState(root);
    assert.equal(loaded?.branch, "superdev-merge");
  } finally {
    cleanup();
  }
});

test("saveMergeState saves to .super-dev/upstream-merge-state.json when no legacy dir exists", () => {
  const { root, cleanup } = createTempProject();
  try {
    writeFileSync(join(root, ".gitignore"), "node_modules/\n");
    saveMergeState(root, mockMergeState);

    const superDevPath = getSuperDevMergeStatePath(root);
    assert.ok(existsSync(superDevPath));
    const loaded = JSON.parse(readFileSync(superDevPath, "utf-8"));
    assert.deepEqual(loaded, mockMergeState);

    // .gitignore should include .super-dev/
    const gitignoreContent = readFileSync(join(root, ".gitignore"), "utf-8");
    assert.ok(gitignoreContent.includes(".super-dev/"));

    // .upstream/ should not exist
    assert.equal(existsSync(join(root, ".upstream")), false);
  } finally {
    cleanup();
  }
});

test("saveMergeState falls back to .upstream/merge-state.json when legacy dir exists", () => {
  const { root, cleanup } = createTempProject();
  try {
    const legacyDir = join(root, ".upstream");
    mkdirSync(legacyDir, { recursive: true });

    saveMergeState(root, mockMergeState);

    const legacyPath = getLegacyMergeStatePath(root);
    assert.ok(existsSync(legacyPath));
    const loaded = JSON.parse(readFileSync(legacyPath, "utf-8"));
    assert.deepEqual(loaded, mockMergeState);

    // .upstream/.gitignore should be created
    assert.ok(existsSync(join(legacyDir, ".gitignore")));

    // .super-dev/upstream-merge-state.json should not exist
    assert.equal(existsSync(getSuperDevMergeStatePath(root)), false);
  } finally {
    cleanup();
  }
});

test("saveMergeState preserves .super-dev state if it already exists even if .upstream dir exists", () => {
  const { root, cleanup } = createTempProject();
  try {
    const superDevDir = join(root, ".super-dev");
    mkdirSync(superDevDir, { recursive: true });
    const superDevPath = getSuperDevMergeStatePath(root);
    writeFileSync(superDevPath, JSON.stringify(mockMergeState, null, 2) + "\n");

    const legacyDir = join(root, ".upstream");
    mkdirSync(legacyDir, { recursive: true });

    const updatedState: MergeState = { ...mockMergeState, branch: "updated-branch" };
    saveMergeState(root, updatedState);

    const loaded = JSON.parse(readFileSync(superDevPath, "utf-8"));
    assert.equal(loaded.branch, "updated-branch");
    assert.equal(existsSync(getLegacyMergeStatePath(root)), false);
  } finally {
    cleanup();
  }
});

test("removeMergeState and clearMergeState clean up all merge state locations", () => {
  const { root, cleanup } = createTempProject();
  try {
    mkdirSync(join(root, ".super-dev"), { recursive: true });
    mkdirSync(join(root, ".upstream"), { recursive: true });

    writeFileSync(getSuperDevMergeStatePath(root), JSON.stringify(mockMergeState));
    writeFileSync(getLegacyMergeStatePath(root), JSON.stringify(mockMergeState));
    writeFileSync(join(root, ".upstream-merge-state.json"), JSON.stringify(mockMergeState));

    assert.ok(existsSync(getSuperDevMergeStatePath(root)));
    assert.ok(existsSync(getLegacyMergeStatePath(root)));
    assert.ok(existsSync(join(root, ".upstream-merge-state.json")));

    removeMergeState(root);

    assert.equal(existsSync(getSuperDevMergeStatePath(root)), false);
    assert.equal(existsSync(getLegacyMergeStatePath(root)), false);
    assert.equal(existsSync(join(root, ".upstream-merge-state.json")), false);

    // Verify clearMergeState alias also works
    writeFileSync(getSuperDevMergeStatePath(root), JSON.stringify(mockMergeState));
    clearMergeState(root);
    assert.equal(existsSync(getSuperDevMergeStatePath(root)), false);
  } finally {
    cleanup();
  }
});
