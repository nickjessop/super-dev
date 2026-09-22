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
  specVersion?: number;            // 2 for new specs, absent for legacy
  specType?: "feature" | "bugfix"; // absent means "feature"
}

// ---------------------------------------------------------------------------
// Upstream config (.upstream/config.json)
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
  reTimestampMigrations?: boolean;
}

// ---------------------------------------------------------------------------
// Super Dev unified config (.super-dev/config.json)
// ---------------------------------------------------------------------------

export interface SuperDevArchConfig {
  source: string;      // default: "docs/architecture"
  reference: string;   // default: "AGENTS.md"
}

export interface SuperDevConfig {
  architecture?: Partial<SuperDevArchConfig>;
  upstream?: UpstreamConfig;
}

// ---------------------------------------------------------------------------
// Architecture Viewer Data Models & Events
// ---------------------------------------------------------------------------

export interface DiagramSection {
  id: string;          // e.g. "5" or "placement-chain"
  title: string;       // e.g. "5. Placement Chain"
  status?: string;     // e.g. "new", "existing", "deprecated"
  summary?: string;    // Brief description
  rawContent: string;  // Full section markdown
}

export interface ArchitectureDiagram {
  id: string;          // Filename without .md (e.g. "credit-pipeline")
  filename: string;    // Filename with .md (e.g. "credit-pipeline.md")
  title: string;       // Display title from frontmatter or first # Heading
  mermaid: string;     // Mermaid diagram source code
  sections: Record<string, DiagramSection>; // Keyed by section ID/title
  updatedAt: number;   // Timestamp of file mtime
}

export interface ViewerInitialPayload {
  activeId: string;
  projectName?: string;
  diagrams: ArchitectureDiagram[];
}

export type ArchServerEvent =
  | { type: "file_change"; id: string; diagram: ArchitectureDiagram }
  | { type: "dir_change"; diagrams: ArchitectureDiagram[] };

export interface CommentMessage {
  id: string;
  author: "user" | "agent";
  text: string;
  createdAt: number;
}

export interface CommentThread {
  id: string;
  doc: string;          // e.g. "overview.md"
  nodeId?: string;      // e.g. "Queue" or "API Gateway"
  x: number;            // Normalized canvas coordinate X
  y: number;            // Normalized canvas coordinate Y
  status: "open" | "resolved";
  messages: CommentMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface CommentsDocumentPayload {
  doc: string;
  threads: CommentThread[];
}

export interface NodeContext {
  nodeId: string;
  label?: string;
  statusClass?: string;       // e.g. "existing" | "new" | "deprecated"
  upstreamNodes: string[];     // nodes pointing to this node
  downstreamNodes: string[];   // nodes this node points to
}

export interface ThreadListenEvent {
  event: "comment_added" | "session_ended" | "timeout";
  thread?: CommentThread;
  latestMessage?: CommentMessage;
  context?: {
    doc: string;
    diagramTitle: string;
    mermaid: string;
    node?: NodeContext;
    section?: DiagramSection;
  };
}

export type ArchDiscussEvent =
  | { type: "comment_added"; thread: CommentThread }
  | { type: "agent_typing"; commentId: string }
  | { type: "agent_reply"; commentId: string; message: CommentMessage }
  | { type: "thread_resolved"; commentId: string }
  | { type: "session_ended"; summary: string };

export interface ArchitectureDiscussionFrontmatter {
  title: string;
  date: string;
  doc: string;
  nodes: string[];
  summary: string;
}

export interface ArchitectureDiscussionRecord {
  filename: string;
  filePath: string;
  frontmatter: ArchitectureDiscussionFrontmatter;
  content: string;
}

// ---------------------------------------------------------------------------
// Upstream merge state (.upstream/merge-state.json)
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
