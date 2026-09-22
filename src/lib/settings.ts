import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { SuperDevArchConfig, SuperDevConfig } from "../types.js";

export type { SuperDevArchConfig, SuperDevConfig };

export const SUPER_DEV_DIR = ".super-dev";
export const SUPER_DEV_CONFIG_FILE = "config.json";

export const DEFAULT_ARCH_CONFIG: SuperDevArchConfig = {
  source: "docs/architecture",
  reference: "AGENTS.md",
};

/**
 * Returns the path to the project's `.super-dev` directory.
 */
export function getSuperDevDir(projectRoot: string): string {
  return join(projectRoot, SUPER_DEV_DIR);
}

/**
 * Returns the path to `<projectRoot>/.super-dev/config.json`.
 */
export function getSuperDevConfigPath(projectRoot: string): string {
  return join(getSuperDevDir(projectRoot), SUPER_DEV_CONFIG_FILE);
}

/**
 * Safely loads and parses `<projectRoot>/.super-dev/config.json`.
 * If missing or invalid JSON, logs a warning and returns `{}`.
 * Never throws unhandled exceptions.
 */
export function loadSuperDevConfig(projectRoot: string): SuperDevConfig {
  try {
    const configPath = getSuperDevConfigPath(projectRoot);
    if (!existsSync(configPath)) {
      return {};
    }

    const content = readFileSync(configPath, "utf-8");
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as SuperDevConfig;
      }
      console.warn(
        `[super-dev] Warning: Config at ${configPath} is not an object. Falling back to defaults.`
      );
      return {};
    } catch (parseErr) {
      console.warn(
        `[super-dev] Warning: Failed to parse ${configPath}: ${
          parseErr instanceof Error ? parseErr.message : String(parseErr)
        }. Falling back to defaults.`
      );
      return {};
    }
  } catch (err) {
    console.warn(
      `[super-dev] Warning: Error reading config from ${projectRoot}: ${
        err instanceof Error ? err.message : String(err)
      }. Falling back to defaults.`
    );
    return {};
  }
}

/**
 * Resolves architecture configuration by merging `.super-dev/config.json` overrides
 * with defaults (`source: "docs/architecture"`, `reference: "AGENTS.md"`).
 * Guarantees a valid, non-empty `source` and `reference`.
 * Never throws unhandled exceptions.
 */
export function getArchConfig(projectRoot: string): SuperDevArchConfig {
  try {
    const config = loadSuperDevConfig(projectRoot);
    const arch = config.architecture;

    const source =
      typeof arch?.source === "string" && arch.source.trim().length > 0
        ? arch.source.trim()
        : DEFAULT_ARCH_CONFIG.source;

    const reference =
      typeof arch?.reference === "string" && arch.reference.trim().length > 0
        ? arch.reference.trim()
        : DEFAULT_ARCH_CONFIG.reference;

    return {
      source,
      reference,
    };
  } catch (err) {
    console.warn(
      `[super-dev] Warning: Error resolving architecture config: ${
        err instanceof Error ? err.message : String(err)
      }. Falling back to defaults.`
    );
    return { ...DEFAULT_ARCH_CONFIG };
  }
}

/**
 * Ensures that `.super-dev/` is listed in `<projectRoot>/.gitignore` if `.gitignore` exists.
 * Does nothing if `.gitignore` does not exist.
 */
export function ensureGitignored(projectRoot: string): void {
  try {
    const gitignorePath = join(projectRoot, ".gitignore");
    if (!existsSync(gitignorePath)) {
      return;
    }

    const content = readFileSync(gitignorePath, "utf-8");
    const lines = content.split(/\r?\n/);
    const alreadyIgnored = lines.some((line) => {
      const trimmed = line.trim();
      return (
        trimmed === ".super-dev" ||
        trimmed === ".super-dev/" ||
        trimmed === "/.super-dev" ||
        trimmed === "/.super-dev/"
      );
    });

    if (!alreadyIgnored) {
      const needsLeadingNewline = content.length > 0 && !content.endsWith("\n");
      const appendText = `${needsLeadingNewline ? "\n" : ""}.super-dev/\n`;
      writeFileSync(gitignorePath, content + appendText, "utf-8");
    }
  } catch (err) {
    console.warn(
      `[super-dev] Warning: Failed to update .gitignore: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

export const ensureSuperDevGitignored = ensureGitignored;

/**
 * Saves or updates configuration to `<projectRoot>/.super-dev/config.json`.
 * Creates the `.super-dev` directory if needed and ensures it is ignored in `.gitignore`.
 * Writes formatted JSON with a trailing newline.
 */
export function saveSuperDevConfig(
  projectRoot: string,
  config: SuperDevConfig
): void {
  try {
    const dir = getSuperDevDir(projectRoot);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    ensureGitignored(projectRoot);

    const configPath = getSuperDevConfigPath(projectRoot);
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  } catch (err) {
    console.error(
      `[super-dev] Error saving config to ${getSuperDevConfigPath(projectRoot)}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Updates `<projectRoot>/.super-dev/config.json` by shallow merging top-level fields.
 */
export function updateSuperDevConfig(
  projectRoot: string,
  updates: Partial<SuperDevConfig>
): SuperDevConfig {
  try {
    const current = loadSuperDevConfig(projectRoot);
    const updated: SuperDevConfig = {
      ...current,
      ...updates,
      ...(updates.architecture || current.architecture
        ? {
            architecture: {
              ...current.architecture,
              ...updates.architecture,
            },
          }
        : {}),
    };
    saveSuperDevConfig(projectRoot, updated);
    return updated;
  } catch (err) {
    console.error(
      `[super-dev] Error updating config: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return loadSuperDevConfig(projectRoot);
  }
}
