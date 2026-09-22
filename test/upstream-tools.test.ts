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
import {
  saveSuperDevConfig,
  loadSuperDevConfig,
  getZedSuperDevDir,
  getLegacySuperDevDir,
} from "../src/lib/settings.js";
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

test("loadConfig loads from .zed/super-dev/config.json when upstream key is present", () => {
  const { root, cleanup } = createTempProject();
  try {
    saveSuperDevConfig(root, { upstream: mockConfig });
    const loaded = loadConfig(root);
    assert.deepEqual(loaded, mockConfig);
  } finally {
    cleanup();
  }
});

test("loadConfig falls back to legacy .super-dev/config.json", () => {
  const { root, cleanup } = createTempProject();
  try {
    const legacyDir = getLegacySuperDevDir(root);
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, "config.json"),
      JSON.stringify({ upstream: mockConfig }, null, 2) + "\n"
    );

    const loaded = loadConfig(root);
    assert.deepEqual(loaded, mockConfig);
  } finally {
    cleanup();
  }
});

test("loadConfig prioritizes .zed/super-dev/config.json over .super-dev/config.json", () => {
  const { root, cleanup } = createTempProject();
  try {
    const zedConfig: UpstreamConfig = { ...mockConfig, branch: "zed-branch" };
    const legacySuperDevConfig: UpstreamConfig = { ...mockConfig, branch: "legacy-super-dev-branch" };

    const zedDir = getZedSuperDevDir(root);
    mkdirSync(zedDir, { recursive: true });
    writeFileSync(join(zedDir, "config.json"), JSON.stringify({ upstream: zedConfig }, null, 2));

    const legacyDir = getLegacySuperDevDir(root);
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "config.json"), JSON.stringify({ upstream: legacySuperDevConfig }, null, 2));

    const loaded = loadConfig(root);
    assert.equal(loaded?.branch, "zed-branch");
  } finally {
    cleanup();
  }
});

test("loadConfig falls back to .upstream/config.json when .zed/super-dev/config.json lacks upstream key", () => {
  const { root, cleanup } = createTempProject();
  try {
    // Write .zed/super-dev/config.json with only architecture
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

test("loadConfig falls back to .upstream/config.json when neither .zed nor .super-dev exists", () => {
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

test("loadConfig prioritizes .zed/super-dev/config.json over .upstream/config.json", () => {
  const { root, cleanup } = createTempProject();
  try {
    const zedConfig: UpstreamConfig = { ...mockConfig, branch: "zed-branch" };
    const legacyConfig: UpstreamConfig = { ...mockConfig, branch: "legacy-branch" };

    saveSuperDevConfig(root, { upstream: zedConfig });

    const upstreamDir = join(root, ".upstream");
    mkdirSync(upstreamDir, { recursive: true });
    writeFileSync(join(upstreamDir, "config.json"), JSON.stringify(legacyConfig, null, 2) + "\n");

    const loaded = loadConfig(root);
    assert.equal(loaded?.branch, "zed-branch");
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

test("saveConfig saves to .zed/super-dev/config.json by default and preserves existing settings", () => {
  const { root, cleanup } = createTempProject();
  try {
    writeFileSync(join(root, ".gitignore"), "node_modules/\n");
    saveSuperDevConfig(root, { architecture: { source: "custom/arch", reference: "CUSTOM.md" } });

    saveConfig(root, mockConfig);

    const superDevConfig = loadSuperDevConfig(root);
    assert.deepEqual(superDevConfig.upstream, mockConfig);
    assert.equal(superDevConfig.architecture?.source, "custom/arch");

    // Check .gitignore was updated with .zed/
    const gitignoreContent = readFileSync(join(root, ".gitignore"), "utf-8");
    assert.ok(gitignoreContent.includes(".zed/"));

    // Saved to .zed/super-dev/config.json
    assert.ok(existsSync(join(getZedSuperDevDir(root), "config.json")));

    // Legacy .upstream/ directory should not have been created
    assert.equal(existsSync(join(root, ".upstream")), false);
  } finally {
    cleanup();
  }
});

test("saveConfig preserves existing .super-dev/config.json if already in use", () => {
  const { root, cleanup } = createTempProject();
  try {
    const legacyDir = getLegacySuperDevDir(root);
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, "config.json"),
      JSON.stringify({ architecture: { source: "legacy/arch" } }, null, 2) + "\n"
    );

    saveConfig(root, mockConfig);

    const config = loadSuperDevConfig(root);
    assert.deepEqual(config.upstream, mockConfig);
    assert.equal(config.architecture?.source, "legacy/arch");
    assert.ok(existsSync(join(legacyDir, "config.json")));
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

    // Should be in .zed/super-dev/config.json
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

test("loadMergeState loads from .zed/super-dev/upstream-merge-state.json", () => {
  const { root, cleanup } = createTempProject();
  try {
    const zedDir = getZedSuperDevDir(root);
    mkdirSync(zedDir, { recursive: true });
    writeFileSync(join(zedDir, "upstream-merge-state.json"), JSON.stringify(mockMergeState, null, 2) + "\n");

    const loaded = loadMergeState(root);
    assert.deepEqual(loaded, mockMergeState);
  } finally {
    cleanup();
  }
});

test("loadMergeState falls back to legacy .super-dev/upstream-merge-state.json", () => {
  const { root, cleanup } = createTempProject();
  try {
    const legacyDir = getLegacySuperDevDir(root);
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "upstream-merge-state.json"), JSON.stringify(mockMergeState, null, 2) + "\n");

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

test("loadMergeState prioritizes .zed/super-dev over legacy .super-dev and .upstream", () => {
  const { root, cleanup } = createTempProject();
  try {
    const stateZed: MergeState = { ...mockMergeState, branch: "zed-merge" };
    const stateLegacySuper: MergeState = { ...mockMergeState, branch: "superdev-merge" };
    const stateUpstream: MergeState = { ...mockMergeState, branch: "upstream-merge" };

    const zedDir = getZedSuperDevDir(root);
    mkdirSync(zedDir, { recursive: true });
    writeFileSync(join(zedDir, "upstream-merge-state.json"), JSON.stringify(stateZed, null, 2) + "\n");

    const legacySuperDir = getLegacySuperDevDir(root);
    mkdirSync(legacySuperDir, { recursive: true });
    writeFileSync(join(legacySuperDir, "upstream-merge-state.json"), JSON.stringify(stateLegacySuper, null, 2) + "\n");

    mkdirSync(join(root, ".upstream"), { recursive: true });
    writeFileSync(getLegacyMergeStatePath(root), JSON.stringify(stateUpstream, null, 2) + "\n");

    const loaded = loadMergeState(root);
    assert.equal(loaded?.branch, "zed-merge");
  } finally {
    cleanup();
  }
});

test("saveMergeState saves to .zed/super-dev/upstream-merge-state.json when no legacy dir exists", () => {
  const { root, cleanup } = createTempProject();
  try {
    writeFileSync(join(root, ".gitignore"), "node_modules/\n");
    saveMergeState(root, mockMergeState);

    const zedPath = join(getZedSuperDevDir(root), "upstream-merge-state.json");
    assert.ok(existsSync(zedPath));
    const loaded = JSON.parse(readFileSync(zedPath, "utf-8"));
    assert.deepEqual(loaded, mockMergeState);

    // .gitignore should include .zed/
    const gitignoreContent = readFileSync(join(root, ".gitignore"), "utf-8");
    assert.ok(gitignoreContent.includes(".zed/"));

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

    // .zed/super-dev/upstream-merge-state.json should not exist
    assert.equal(existsSync(join(getZedSuperDevDir(root), "upstream-merge-state.json")), false);
  } finally {
    cleanup();
  }
});

test("saveMergeState preserves .zed state if it already exists even if .upstream dir exists", () => {
  const { root, cleanup } = createTempProject();
  try {
    const zedDir = getZedSuperDevDir(root);
    mkdirSync(zedDir, { recursive: true });
    const zedPath = join(zedDir, "upstream-merge-state.json");
    writeFileSync(zedPath, JSON.stringify(mockMergeState, null, 2) + "\n");

    const legacyDir = join(root, ".upstream");
    mkdirSync(legacyDir, { recursive: true });

    const updatedState: MergeState = { ...mockMergeState, branch: "updated-branch" };
    saveMergeState(root, updatedState);

    const loaded = JSON.parse(readFileSync(zedPath, "utf-8"));
    assert.equal(loaded.branch, "updated-branch");
    assert.equal(existsSync(getLegacyMergeStatePath(root)), false);
  } finally {
    cleanup();
  }
});

test("removeMergeState and clearMergeState clean up all merge state locations", () => {
  const { root, cleanup } = createTempProject();
  try {
    const zedDir = getZedSuperDevDir(root);
    const legacySuperDir = getLegacySuperDevDir(root);
    mkdirSync(zedDir, { recursive: true });
    mkdirSync(legacySuperDir, { recursive: true });
    mkdirSync(join(root, ".upstream"), { recursive: true });

    const zedPath = join(zedDir, "upstream-merge-state.json");
    const legacySuperPath = join(legacySuperDir, "upstream-merge-state.json");
    const legacyUpstreamPath = getLegacyMergeStatePath(root);
    const rootLegacyPath = join(root, ".upstream-merge-state.json");

    writeFileSync(zedPath, JSON.stringify(mockMergeState));
    writeFileSync(legacySuperPath, JSON.stringify(mockMergeState));
    writeFileSync(legacyUpstreamPath, JSON.stringify(mockMergeState));
    writeFileSync(rootLegacyPath, JSON.stringify(mockMergeState));

    assert.ok(existsSync(zedPath));
    assert.ok(existsSync(legacySuperPath));
    assert.ok(existsSync(legacyUpstreamPath));
    assert.ok(existsSync(rootLegacyPath));

    removeMergeState(root);

    assert.equal(existsSync(zedPath), false);
    assert.equal(existsSync(legacySuperPath), false);
    assert.equal(existsSync(legacyUpstreamPath), false);
    assert.equal(existsSync(rootLegacyPath), false);
  } finally {
    cleanup();
  }
});
