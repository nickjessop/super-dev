// Shared type definitions for super-dev.

import type { z } from "zod";

// ---------------------------------------------------------------------------
// MCP tool primitives
// ---------------------------------------------------------------------------

/** MCP text content item */
export interface TextContent {
  type: "text";
  text: string;
}

/** Standard MCP tool handler result */
export interface ToolResult {
  content: TextContent[];
  isError?: boolean;
}

/** Context object passed to every tool handler */
export interface AppContext {
  readonly projectRoot: string;
}

/** Tool definition shape exported by all lib modules */
export interface ToolDef {
  name: string;
  description: string;
  schema: Record<string, z.ZodType>;
  handler: (
    args: Record<string, unknown>,
    ctx: AppContext,
  ) => Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Spec state (.specs/<name>/state.json)
// ---------------------------------------------------------------------------

export type SpecPhase =
  | "requirements"
  | "design"
  | "tasks"
  | "implementation"
  | "done";

export interface SpecState {
  phase: SpecPhase;
  approved: {
    requirements: boolean;
    design: boolean;
    tasks: boolean;
  };
  description: string;
  createdAt: string;
  adoptedAt?: string;
  autoCommit?: boolean;
}

// ---------------------------------------------------------------------------
// Upstream config (.upstream.json)
// ---------------------------------------------------------------------------

export interface UpstreamPolicies {
  always_ours: string[];
  always_theirs: string[];
  manual_review: string[];
}

export interface UpstreamConfig {
  remote: string;
  branch: string;
  policies: UpstreamPolicies;
  categories: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Upstream merge state (.upstream-merge-state.json)
// ---------------------------------------------------------------------------

export interface MergeState {
  branch: string;
  previousBranch: string;
  remote: string;
  remoteBranch: string;
  startedAt: string;
  conflicts: string[];
  allChangedFiles: string[];
  resolved: Record<string, true>;
  status: "in_progress" | "no_conflicts";
}

// ---------------------------------------------------------------------------
// Deprecation watch (.super-dev-flags.json)
// ---------------------------------------------------------------------------

export interface DeprecationFlag {
  firstSeen: string;
  clientVersion: string | null;
}

export type DeprecationFlags = Record<string, DeprecationFlag>;

export interface DeprecationWatchOptions {
  readonly projectRoot: string;
  getClientInfo: () => unknown;
}

export interface DeprecationWatcher {
  onResourcesUsed: () => void;
}

// ---------------------------------------------------------------------------
// Thread data (Zed threads.db)
// ---------------------------------------------------------------------------

export interface ThreadRow {
  id: string;
  summary: string;
  updated_at: string;
  folder_paths?: string;
  created_at?: string;
}

/** Content parts within a message — intentionally loose since Zed's format varies */
export type ContentPart =
  | string
  | { Text: string }
  | { ToolUse: unknown }
  | { ToolResult: unknown }
  | { Thinking: unknown };

export interface ThreadMessage {
  User?: { content: ContentPart[] };
  Agent?: { content: ContentPart[] };
}

export interface ThreadData {
  messages: ThreadMessage[];
}

// ---------------------------------------------------------------------------
// Rules (.rules/*.md)
// ---------------------------------------------------------------------------

export type RuleInclusion = "always" | "auto" | "manual";

export interface ParsedRule {
  name: string;
  description: string;
  inclusion: RuleInclusion;
  globs: string[];
  body: string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
