import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type {
  ToolDef,
  ToolResult,
  AppContext,
  ArchitectureDiagram,
  DiagramSection,
  ViewerInitialPayload,
  ArchServerEvent,
  CommentMessage,
  CommentThread,
  CommentsDocumentPayload,
  NodeContext,
  ThreadListenEvent,
  ArchDiscussEvent,
  ArchitectureDiscussionFrontmatter,
  ArchitectureDiscussionRecord,
} from "../types.js";
import { ok, err } from "../types.js";
import { getArchConfig, getCommentsDir, ensureGitignored } from "./settings.js";

export type {
  ArchitectureDiagram,
  DiagramSection,
  ViewerInitialPayload,
  ArchServerEvent,
  CommentMessage,
  CommentThread,
  CommentsDocumentPayload,
  NodeContext,
  ThreadListenEvent,
  ArchDiscussEvent,
  ArchitectureDiscussionFrontmatter,
  ArchitectureDiscussionRecord,
};

export { getCommentsDir };

// ---------------------------------------------------------------------------
// Live Comment Discussion Cache & Storage (.zed/super-dev/comments/<doc>.json)
// ---------------------------------------------------------------------------

/**
 * In-memory cache of active comment threads per document.
 * Keyed by document filename/identifier (e.g. "overview.md"), mapping to thread ID -> CommentThread.
 */
export const activeCommentThreads = new Map<string, Map<string, CommentThread>>();

/**
 * Clears the in-memory comment cache (useful in tests or when resetting state).
 */
export function clearCommentCache(): void {
  activeCommentThreads.clear();
}

/**
 * Returns the resolved file path for storing comment threads for a given document.
 * Sanitizes the document filename to prevent path traversal.
 */
export function getCommentFilePath(projectRoot: string, doc: string): string {
  const commentsDir = getCommentsDir(projectRoot);
  const baseDoc = path.basename(doc);
  const filename = baseDoc.endsWith(".json") ? baseDoc : `${baseDoc}.json`;
  return path.join(commentsDir, filename);
}

/**
 * Loads comment threads for a given document.
 * 1. Returns from in-memory cache if already loaded.
 * 2. Otherwise reads from `<projectRoot>/.zed/super-dev/comments/<doc>.json`.
 * If missing, invalid JSON, or upon any I/O error, returns empty array without throwing.
 */
export function loadComments(projectRoot: string, doc: string): CommentThread[] {
  try {
    const cached = activeCommentThreads.get(doc);
    if (cached) {
      return Array.from(cached.values());
    }

    const commentsDir = getCommentsDir(projectRoot);
    const candidateFiles = [getCommentFilePath(projectRoot, doc)];
    const base = path.basename(doc);
    if (base.endsWith(".md")) {
      candidateFiles.push(path.join(commentsDir, `${base.slice(0, -3)}.json`));
    } else if (!base.endsWith(".json")) {
      candidateFiles.push(path.join(commentsDir, `${base}.md.json`));
    }

    let targetFilePath: string | undefined;
    for (const file of candidateFiles) {
      if (fs.existsSync(file)) {
        targetFilePath = file;
        break;
      }
    }

    if (!targetFilePath) {
      activeCommentThreads.set(doc, new Map());
      return [];
    }

    const content = fs.readFileSync(targetFilePath, "utf-8");
    const parsed = JSON.parse(content);
    let threads: CommentThread[] = [];
    if (Array.isArray(parsed)) {
      threads = parsed;
    } else if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as any).threads)
    ) {
      threads = (parsed as any).threads;
    }

    const threadMap = new Map<string, CommentThread>();
    for (const t of threads) {
      if (t && typeof t === "object" && t.id) {
        threadMap.set(t.id, t);
      }
    }
    activeCommentThreads.set(doc, threadMap);
    return threads;
  } catch (err) {
    console.warn(
      `[super-dev] Warning: Failed to load comments for ${doc}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    activeCommentThreads.set(doc, new Map());
    return [];
  }
}

/**
 * Persists comment threads for a given document to disk and updates in-memory cache.
 * Writes snapshot to `<projectRoot>/.zed/super-dev/comments/<doc>.json` cleanly without throwing on disk errors.
 */
export function saveComments(
  projectRoot: string,
  doc: string,
  threads: CommentThread[]
): void {
  try {
    // 1. Update in-memory cache
    const threadMap = new Map<string, CommentThread>();
    for (const t of threads) {
      if (t && typeof t === "object" && t.id) {
        threadMap.set(t.id, t);
      }
    }
    activeCommentThreads.set(doc, threadMap);

    // 2. Ensure directory exists and is gitignored
    const commentsDir = getCommentsDir(projectRoot);
    if (!fs.existsSync(commentsDir)) {
      fs.mkdirSync(commentsDir, { recursive: true });
    }
    ensureGitignored(projectRoot, ".zed/");

    // 3. Write snapshot with trailing newline
    const filePath = getCommentFilePath(projectRoot, doc);
    fs.writeFileSync(filePath, JSON.stringify(threads, null, 2) + "\n", "utf-8");
  } catch (err) {
    console.warn(
      `[super-dev] Warning: Failed to save comments for ${doc}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

// ---------------------------------------------------------------------------
// Starter Template & Scaffolding
// ---------------------------------------------------------------------------

export const STARTER_OVERVIEW_TEMPLATE = `---
title: System Architecture Overview
---

# System Architecture Overview

\`\`\`mermaid
flowchart TD
  subgraph Ingestion [Ingestion Layer]
    API[API Gateway]:::existing
    Queue[Event Bus]:::new
  end
  subgraph Processing [Processing Core]
    Worker[Worker Pool]:::new
    DB[(Primary Database)]:::existing
  end

  API --> Queue
  Queue --> Worker
  Worker --> DB

  classDef existing fill:#1e293b,stroke:#64748b,stroke-width:2px,color:#f8fafc;
  classDef new fill:#1e3a8a,stroke:#3b82f6,stroke-width:2px,color:#f8fafc;
\`\`\`

## 1. API Gateway
Status: existing
Summary: Handles external ingress, authentication, and request routing.

## 2. Event Bus
Status: new
Summary: Decouples intake from processing with persistent buffering.

## 3. Worker Pool
Status: new
Summary: Scalable asynchronous execution workers.

## 4. Primary Database
Status: existing
Summary: Relational database storing core transactional entities.
`;

/**
 * Ensures reference document (e.g. AGENTS.md) contains a link to the architecture overview.
 */
export function ensureAgentsReference(
  projectRoot: string,
  docRelPath: string = "docs/architecture/overview.md",
  referenceFile: string = "AGENTS.md"
): void {
  try {
    const agentsPath = path.join(projectRoot, referenceFile);
    const linkLine = `- [Architecture Overview](${docRelPath})`;

    if (!fs.existsSync(agentsPath)) {
      const initialContent = `## Project Reference Docs\n${linkLine}\n`;
      fs.writeFileSync(agentsPath, initialContent, "utf-8");
      return;
    }

    const content = fs.readFileSync(agentsPath, "utf-8");
    if (content.includes("[Architecture Overview]") || content.includes(docRelPath)) {
      return;
    }

    if (content.includes("## Project Reference Docs")) {
      const lines = content.split(/\r?\n/);
      const headerIdx = lines.findIndex((l) =>
        l.trim().startsWith("## Project Reference Docs")
      );
      if (headerIdx !== -1) {
        lines.splice(headerIdx + 1, 0, linkLine);
        fs.writeFileSync(agentsPath, lines.join("\n"), "utf-8");
        return;
      }
    }

    const needsNewline = content.length > 0 && !content.endsWith("\n");
    const appendText = `${needsNewline ? "\n" : ""}\n## Project Reference Docs\n${linkLine}\n`;
    fs.writeFileSync(agentsPath, content + appendText, "utf-8");
  } catch (error) {
    console.warn(
      `[super-dev] Warning: Failed to update reference file ${referenceFile}:`,
      error
    );
  }
}

/**
 * Scaffolds starter architecture docs if directory is empty or missing.
 */
export function scaffoldArchitecture(
  projectRoot: string,
  targetDir: string,
  referenceFile: string = "AGENTS.md"
): boolean {
  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const overviewFile = path.join(targetDir, "overview.md");
    if (!fs.existsSync(overviewFile)) {
      fs.writeFileSync(overviewFile, STARTER_OVERVIEW_TEMPLATE, "utf-8");
    }

    const relDocPath = path
      .relative(projectRoot, overviewFile)
      .replace(/\\/g, "/");
    ensureAgentsReference(projectRoot, relDocPath, referenceFile);

    return true;
  } catch (error) {
    console.error(`[super-dev] Failed to scaffold architecture at ${targetDir}:`, error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Markdown Parser & Directory Scanner
// ---------------------------------------------------------------------------

/**
 * Parses architecture markdown content extracting frontmatter title or H1,
 * mermaid code block, and numbered/subtitled sections.
 */
export function parseArchitectureMarkdown(
  content: string,
  filename: string,
  mtimeMs: number = Date.now()
): ArchitectureDiagram {
  try {
    const fileId = filename.replace(/\.md$/i, "");
    let title: string | undefined;
    let bodyContent = content;

    // 1. YAML frontmatter title
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (frontmatterMatch) {
      const yaml = frontmatterMatch[1];
      bodyContent = content.slice(frontmatterMatch[0].length);
      const titleMatch = yaml.match(/^title:\s*(.+)$/m);
      if (titleMatch) {
        title = titleMatch[1].trim().replace(/^["'](.*)["']$/, "$1").trim();
      }
    }

    // 2. First # Heading in content
    if (!title) {
      const headingMatch = bodyContent.match(/^#\s+(.+)$/m);
      if (headingMatch) {
        title = headingMatch[1].trim();
      }
    }

    // 3. Fallback: filename without .md
    if (!title) {
      title = fileId;
    }

    // Extract Mermaid diagram
    const mermaidMatch = content.match(/```mermaid\s*([\s\S]*?)```/);
    const mermaid = mermaidMatch
      ? mermaidMatch[1].trim()
      : `flowchart TD\n  Empty["No Mermaid diagram defined in ${filename}"]`;

    // Extract sections from body content (ignoring code blocks)
    const contentWithoutCode = bodyContent.replace(/```[\s\S]*?```/g, "");
    const sections: Record<string, DiagramSection> = {};

    const headingMatches = [
      ...contentWithoutCode.matchAll(/^#{2,3}\s+([^\r\n]+)$/gm),
    ];

    for (let i = 0; i < headingMatches.length; i++) {
      const currentMatch = headingMatches[i];
      const headingTitle = currentMatch[1].trim();
      const startIdx = currentMatch.index + currentMatch[0].length;
      const endIdx =
        i + 1 < headingMatches.length
          ? headingMatches[i + 1].index
          : contentWithoutCode.length;
      const rawSectionContent = contentWithoutCode
        .slice(startIdx, endIdx)
        .trim();

      const statusMatch = rawSectionContent.match(
        /Status:\s*([a-zA-Z0-9_-]+)/i
      );
      const status = statusMatch ? statusMatch[1].toLowerCase() : undefined;

      const summaryMatch = rawSectionContent.match(/Summary:\s*([^\r\n]+)/i);
      const summary = summaryMatch ? summaryMatch[1].trim() : undefined;

      const numPrefixMatch = headingTitle.match(/^(\d+(?:\.\d+)*)[\.\s]/);
      const numericId = numPrefixMatch ? numPrefixMatch[1] : undefined;

      const slug = headingTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      const sectionId = numericId || slug || headingTitle;

      const section: DiagramSection = {
        id: sectionId,
        title: headingTitle,
        status,
        summary,
        rawContent: rawSectionContent,
      };

      sections[sectionId] = section;
      sections[headingTitle] = section;
      if (slug && slug !== sectionId) {
        sections[slug] = section;
      }
      if (numericId) {
        sections[numericId] = section;
        const titleWithoutNum = headingTitle
          .replace(/^\d+(?:\.\d+)*[\.\s]+/, "")
          .trim();
        if (titleWithoutNum) {
          sections[titleWithoutNum] = section;
          const strippedSlug = titleWithoutNum
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
          if (strippedSlug) {
            sections[strippedSlug] = section;
          }
        }
      }

      // Also index leading token before separator (e.g. "Upload1: Document Upload" -> "Upload1", "Mask - PII" -> "Mask")
      const tokenMatch = headingTitle.match(/^([a-zA-Z0-9_-]+)\s*[:\-\—\·\|]/);
      if (tokenMatch) {
        const token = tokenMatch[1].trim();
        sections[token] = section;
        sections[token.toLowerCase()] = section;
      }
    }

    return {
      id: fileId,
      filename,
      title,
      mermaid,
      sections,
      updatedAt: mtimeMs,
    };
  } catch (parseError) {
    const fileId = filename.replace(/\.md$/i, "");
    return {
      id: fileId,
      filename,
      title: fileId,
      mermaid: `flowchart TD\n  Empty["Error parsing ${filename}"]`,
      sections: {},
      updatedAt: mtimeMs,
    };
  }
}

/**
 * Scans a directory for all *.md files and parses each as an ArchitectureDiagram.
 */
export function scanArchitectureDir(dirPath: string): ArchitectureDiagram[] {
  try {
    if (!fs.existsSync(dirPath)) {
      return [];
    }

    const files = fs.readdirSync(dirPath);
    const mdFiles = files.filter(
      (f) => f.endsWith(".md") && !f.startsWith(".")
    );

    const diagrams: ArchitectureDiagram[] = [];

    for (const filename of mdFiles) {
      const fullPath = path.join(dirPath, filename);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          const content = fs.readFileSync(fullPath, "utf-8");
          diagrams.push(
            parseArchitectureMarkdown(content, filename, stat.mtimeMs)
          );
        }
      } catch (fileErr) {
        console.warn(`[super-dev] Warning: Failed to read ${fullPath}:`, fileErr);
      }
    }

    // Sort diagrams so overview.md is first, followed by alphabetical order
    diagrams.sort((a, b) => {
      if (a.id === "overview") return -1;
      if (b.id === "overview") return 1;
      return a.title.localeCompare(b.title);
    });

    return diagrams;
  } catch (error) {
    console.error(`[super-dev] Error scanning directory ${dirPath}:`, error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Architectural Context Extractor & Mermaid Parser
// ---------------------------------------------------------------------------

/**
 * Extracts architectural context for a given node within a Mermaid diagram:
 * - Resolves node label and status class (inline `:::class` or `class` statements)
 * - Resolves upstream connections (pointing to nodeId, or undirected)
 * - Resolves downstream connections (nodeId pointing to other nodes, or undirected)
 */
export function extractNodeContext(
  mermaid: string,
  nodeId: string
): NodeContext {
  const trimmedNodeId = nodeId.trim();
  if (!trimmedNodeId) {
    return {
      nodeId: "",
      upstreamNodes: [],
      downstreamNodes: [],
    };
  }

  // 1. First pass: Collect all node definitions (id -> { label, statusClass })
  interface NodeDef {
    id: string;
    label?: string;
    statusClass?: string;
  }
  const nodesMap = new Map<string, NodeDef>();

  function registerNode(id: string, label?: string, statusClass?: string) {
    const existing = nodesMap.get(id);
    if (!existing) {
      nodesMap.set(id, {
        id,
        label: label ? label.trim() : undefined,
        statusClass: statusClass ? statusClass.trim() : undefined,
      });
    } else {
      if (label && !existing.label) existing.label = label.trim();
      if (statusClass && !existing.statusClass)
        existing.statusClass = statusClass.trim();
    }
  }

  // Bracket delimiters in Mermaid:
  // [((...))] cylinder, ([...]) stadium, [[...]] subroutine, (((...))) double circle,
  // ((...)) circle, {{...}} hexagon, [/.../] parallelogram, [\...\] parallelogram alt,
  // [...] rect, (...) rounded, {...} rhombus, >...] asymmetric flag
  const nodeDefRegex =
    /([a-zA-Z0-9_-]+)\s*(?:\[\(([\s\S]*?)\)\]|\(\[([\s\S]*?)\]\)|\(\(\(([\s\S]*?)\)\)\)|\(\(([\s\S]*?)\)\)|\[\[([\s\S]*?)\]\]|\{\{([\s\S]*?)\}\}|\[\/([\s\S]*?)[\/\\]\]|\[\\([\s\S]*?)[\/\\]\]|\[([\s\S]*?)\]|\(([\s\S]*?)\)|\{([\s\S]*?)\}|>([\s\S]*?)\])(?:\s*:::([a-zA-Z0-9_-]+))?/g;

  let match: RegExpExecArray | null;
  while ((match = nodeDefRegex.exec(mermaid)) !== null) {
    const id = match[1];
    let label: string | undefined;
    for (let i = 2; i <= 13; i++) {
      if (match[i] !== undefined) {
        label = match[i].trim();
        if (
          (label.startsWith('"') && label.endsWith('"')) ||
          (label.startsWith("'") && label.endsWith("'"))
        ) {
          label = label.slice(1, -1).trim();
        }
        break;
      }
    }
    const statusClass = match[14];
    registerNode(id, label, statusClass);
  }

  // Bare node with class (e.g. `Node:::existing`)
  const bareClassRegex = /([a-zA-Z0-9_-]+):::([a-zA-Z0-9_-]+)/g;
  while ((match = bareClassRegex.exec(mermaid)) !== null) {
    registerNode(match[1], undefined, match[2]);
  }

  // Class assignment statements (e.g. `class API,Queue existing;` or `class API existing;`)
  const classStmtRegex = /^\s*class\s+([^;\n]+)\s+([a-zA-Z0-9_-]+);?/gm;
  while ((match = classStmtRegex.exec(mermaid)) !== null) {
    const ids = match[1].split(",").map((s) => s.trim());
    const cls = match[2].trim();
    for (const id of ids) {
      if (id) registerNode(id, undefined, cls);
    }
  }

  // 2. Resolve target node ID:
  // If `trimmedNodeId` exists directly in nodesMap, use it.
  // Otherwise, check if `trimmedNodeId` matches any node's label case-insensitively.
  let targetId = trimmedNodeId;
  if (!nodesMap.has(targetId)) {
    const lower = trimmedNodeId.toLowerCase();
    for (const [id, def] of nodesMap.entries()) {
      if (def.label && def.label.toLowerCase() === lower) {
        targetId = id;
        break;
      }
    }
  }

  const targetDef = nodesMap.get(targetId);
  const resolvedLabel = targetDef?.label;
  const resolvedStatus = targetDef?.statusClass;

  // 3. Second pass: Parse connections (upstream and downstream)
  const linkRegex =
    /\s*(<-->|<==>|-->\s*\|[^|]+\||-->|--\s*[^-\n>]+\s*-->|==>\s*\|[^|]+\||==>|==\s*[^=\n>]+\s*==>|-\.->\s*\|[^|]+\||-\.->|-\.\s*[^.\n>]+\s*\.->|<--\s*\|[^|]+\||<--|<==\s*\|[^|]+\||<==|---\s*\|[^|]+\||---|--\s*[^-\n]+\s*---|===\s*\|[^|]+\||===|==\s*[^=\n]+\s*===|-\.-\s*\|[^|]+\||-\.-|-\.\s*[^.\n]+\s*\.-)\s*/;

  const upstreamSet = new Set<string>();
  const downstreamSet = new Set<string>();

  const lines = mermaid.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (
      !line ||
      line.startsWith("%%") ||
      line.startsWith("subgraph") ||
      line === "end" ||
      line.startsWith("classDef") ||
      line.startsWith("class ") ||
      line.startsWith("style ") ||
      line.startsWith("click ") ||
      line.startsWith("flowchart") ||
      line.startsWith("graph")
    ) {
      continue;
    }

    const parts = line.split(linkRegex);
    if (parts.length < 3) {
      continue;
    }

    for (let i = 0; i < parts.length - 2; i += 2) {
      const leftSegment = parts[i];
      const linkDelim = parts[i + 1];
      const rightSegment = parts[i + 2];

      const leftIdMatch = leftSegment.trim().match(/^([a-zA-Z0-9_-]+)/);
      const rightIdMatch = rightSegment.trim().match(/^([a-zA-Z0-9_-]+)/);
      if (!leftIdMatch || !rightIdMatch) continue;

      const leftId = leftIdMatch[1];
      const rightId = rightIdMatch[1];

      if (!nodesMap.has(leftId)) registerNode(leftId);
      if (!nodesMap.has(rightId)) registerNode(rightId);

      const hasLeftArrow = linkDelim.includes("<");
      const hasRightArrow = linkDelim.includes(">");

      if (hasLeftArrow && hasRightArrow) {
        // Bidirectional: left <--> right
        if (leftId === targetId && rightId !== targetId) {
          upstreamSet.add(rightId);
          downstreamSet.add(rightId);
        }
        if (rightId === targetId && leftId !== targetId) {
          upstreamSet.add(leftId);
          downstreamSet.add(leftId);
        }
      } else if (hasRightArrow && !hasLeftArrow) {
        // Forward: left --> right
        if (rightId === targetId && leftId !== targetId) {
          upstreamSet.add(leftId);
        }
        if (leftId === targetId && rightId !== targetId) {
          downstreamSet.add(rightId);
        }
      } else if (hasLeftArrow && !hasRightArrow) {
        // Backward: left <-- right
        if (leftId === targetId && rightId !== targetId) {
          upstreamSet.add(rightId);
        }
        if (rightId === targetId && leftId !== targetId) {
          downstreamSet.add(leftId);
        }
      } else {
        // Undirected: left --- right
        if (leftId === targetId && rightId !== targetId) {
          upstreamSet.add(rightId);
          downstreamSet.add(rightId);
        }
        if (rightId === targetId && leftId !== targetId) {
          upstreamSet.add(leftId);
          downstreamSet.add(leftId);
        }
      }
    }
  }

  return {
    nodeId: targetId,
    label: resolvedLabel,
    statusClass: resolvedStatus,
    upstreamNodes: Array.from(upstreamSet),
    downstreamNodes: Array.from(downstreamSet),
  };
}

/**
 * Finds the matching DiagramSection for a node based on its nodeId, label, or numeric section ID.
 */
export function findMatchingSection(
  diagram: ArchitectureDiagram,
  nodeId: string,
  label?: string
): DiagramSection | undefined {
  if (!diagram || !diagram.sections) return undefined;

  // 1. Direct key match with nodeId
  if (diagram.sections[nodeId]) {
    return diagram.sections[nodeId];
  }

  // 2. Direct key match with label
  if (label && diagram.sections[label]) {
    return diagram.sections[label];
  }

  // 3. Slug match with nodeId
  const nodeSlug = nodeId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (nodeSlug && diagram.sections[nodeSlug]) {
    return diagram.sections[nodeSlug];
  }

  // 4. Slug match with label
  if (label) {
    const labelSlug = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (labelSlug && diagram.sections[labelSlug]) {
      return diagram.sections[labelSlug];
    }
  }

  // 5. Check if any section title contains label or nodeId
  const uniqueSections = Array.from(new Set(Object.values(diagram.sections)));
  if (label) {
    const labelLower = label.toLowerCase();
    for (const sec of uniqueSections) {
      if (sec.title.toLowerCase().includes(labelLower)) {
        return sec;
      }
    }
  }

  const nodeIdLower = nodeId.toLowerCase();
  for (const sec of uniqueSections) {
    if (sec.title.toLowerCase().includes(nodeIdLower)) {
      return sec;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// HTML Viewer Template Resolution
// ---------------------------------------------------------------------------

function getTemplatePath(projectRoot: string): string | null {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.join(currentDir, "..", "..", "templates", "arch-viewer.html"),
    path.join(projectRoot, "templates", "arch-viewer.html"),
    path.join(process.cwd(), "templates", "arch-viewer.html"),
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function getTemplateHtml(projectRoot: string): string {
  const resolvedPath = getTemplatePath(projectRoot);
  if (resolvedPath && fs.existsSync(resolvedPath)) {
    return fs.readFileSync(resolvedPath, "utf-8");
  }

  // Graceful fallback if template file is somehow missing
  return `<!DOCTYPE html>
<html>
<head><title>Architecture Viewer</title></head>
<body style="background:#0f1117;color:#f0f6fc;font-family:sans-serif;padding:40px;">
  <h1>Super Dev Architecture Viewer</h1>
  <p>Viewer template could not be loaded. Please ensure templates/arch-viewer.html exists.</p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Ephemeral HTTP & SSE Live Server
// ---------------------------------------------------------------------------

export interface ArchServerInstance {
  server: http.Server;
  port: number;
  dirPath: string;
  watcher: fs.FSWatcher | null;
  getDiagrams: () => ArchitectureDiagram[];
  broadcastSSE: (event: ArchServerEvent | ArchDiscussEvent) => void;
  close: () => Promise<void>;
}

// Active server instances keyed by normalized target directory path
const activeServers = new Map<string, ArchServerInstance>();

/**
 * Returns currently active servers.
 */
export function getActiveArchServers(): Map<string, ArchServerInstance> {
  return activeServers;
}

// ---------------------------------------------------------------------------
// Long-Poll Bridge Manager for Live Discussion
// ---------------------------------------------------------------------------

export type LongPollWaiter = (event: ThreadListenEvent) => void;
export let pendingListenWaiters: LongPollWaiter[] = [];
export let unhandledEvents: ThreadListenEvent[] = [];

/**
 * Clears long-poll listener queue and unhandled events (used in tests and teardowns).
 */
export function clearLongPollWaiters(): void {
  pendingListenWaiters = [];
  unhandledEvents = [];
}

/**
 * Notifies active long-poll waiters of an event, or enqueues it if no waiter is listening.
 */
export function notifyWaiters(event: ThreadListenEvent): void {
  if (pendingListenWaiters.length > 0) {
    const waiters = [...pendingListenWaiters];
    pendingListenWaiters = [];
    for (const waiter of waiters) {
      try {
        waiter(event);
      } catch (err) {
        console.warn("[super-dev] Error notifying long-poll waiter:", err);
      }
    }
  } else {
    unhandledEvents.push(event);
  }
}

/**
 * Safely reads and parses a JSON request body with size limits (1MB) and error handling.
 */
export async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf-8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Payload Too Large"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Broadcasts an SSE event to all connected clients across all active preview servers.
 */
export function broadcastToActiveServers(
  event: ArchServerEvent | ArchDiscussEvent
): void {
  for (const instance of activeServers.values()) {
    instance.broadcastSSE(event);
  }
}

/**
 * Helper to bind an HTTP server to 127.0.0.1 with port conflict retry.
 */
async function bindHttpServer(
  server: http.Server,
  preferredPort?: number
): Promise<number> {
  const maxAttempts = 10;
  let currentPort = preferredPort && preferredPort > 0 ? preferredPort : 0;

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    const portToTry = attempt === maxAttempts ? 0 : currentPort;
    const bound = await new Promise<number | null>((resolve, reject) => {
      function onError(err: NodeJS.ErrnoException) {
        server.removeListener("listening", onListening);
        if (err.code === "EADDRINUSE" && attempt < maxAttempts) {
          resolve(null);
        } else {
          reject(err);
        }
      }

      function onListening() {
        server.removeListener("error", onError);
        const addr = server.address();
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          reject(new Error("Unable to determine server address"));
        }
      }

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(portToTry, "127.0.0.1");
    });

    if (bound !== null) {
      return bound;
    }

    currentPort++;
  }

  throw new Error("Failed to bind HTTP server to 127.0.0.1 after retries");
}

export interface StartArchServerOptions {
  projectRoot: string;
  dirPath: string;
  preferredPort?: number;
}

/**
 * Starts or retrieves an active HTTP & SSE preview server for the architecture directory.
 */
export async function startArchServer(
  options: StartArchServerOptions
): Promise<ArchServerInstance> {
  const normalizedDir = path.normalize(path.resolve(options.dirPath));

  // If a server is already listening for this directory, return it
  const existing = activeServers.get(normalizedDir);
  if (existing && existing.server.listening) {
    return existing;
  }

  let currentDiagrams = scanArchitectureDir(normalizedDir);
  const sseClients = new Set<http.ServerResponse>();

  function broadcastSSE(event: ArchServerEvent | ArchDiscussEvent) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(data);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  // Create HTTP server strictly bound to 127.0.0.1
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = parsedUrl.pathname;

    // OPTIONS: CORS preflight for all endpoints
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    // GET /: Main HTML Viewer with injected payload
    if (pathname === "/") {
      try {
        const rawHtml = getTemplateHtml(options.projectRoot);
        const requestedDoc = parsedUrl.searchParams.get("doc");
        let activeId = currentDiagrams[0]?.id || "";

        if (requestedDoc) {
          const match = currentDiagrams.find(
            (d) =>
              d.filename === requestedDoc ||
              d.id === requestedDoc ||
              d.filename === `${requestedDoc}.md`
          );
          if (match) {
            activeId = match.id;
          }
        }

        const initialPayload: ViewerInitialPayload = {
          activeId,
          diagrams: currentDiagrams,
        };

        const injectedHtml = rawHtml.replace(
          /<script id="arch-data" type="application\/json">[\s\S]*?<\/script>/,
          `<script id="arch-data" type="application/json">\n${JSON.stringify(
            initialPayload,
            null,
            2
          )}\n</script>`
        );

        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        res.end(injectedHtml);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error rendering architecture viewer");
      }
      return;
    }

    // GET /events: Server-Sent Events stream
    if (pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(": connected\n\n");

      sseClients.add(res);

      const pingInterval = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          clearInterval(pingInterval);
          sseClients.delete(res);
        }
      }, 15000);
      pingInterval.unref();

      req.on("close", () => {
        clearInterval(pingInterval);
        sseClients.delete(res);
      });
      return;
    }

    // GET /api/diagrams: JSON API endpoint
    if (pathname === "/api/diagrams") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(currentDiagrams));
      return;
    }

    // GET /api/comments: Retrieve active threads for a document
    if (pathname === "/api/comments" && req.method === "GET") {
      try {
        const docParam = parsedUrl.searchParams.get("doc");
        let targetDoc = docParam;
        if (targetDoc) {
          if (
            targetDoc.includes("..") ||
            targetDoc.includes("/") ||
            targetDoc.includes("\\")
          ) {
            res.writeHead(400, {
              "Content-Type": "application/json; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            });
            res.end(JSON.stringify({ error: "Invalid doc parameter" }));
            return;
          }
        } else {
          targetDoc = currentDiagrams[0]?.filename || "overview.md";
        }

        const threads = loadComments(options.projectRoot, targetDoc);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        });
        res.end(JSON.stringify(threads));
      } catch (err) {
        res.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ error: "Failed to load comments" }));
      }
      return;
    }

    // POST /api/comments: Submit a comment or follow-up reply
    if (pathname === "/api/comments" && req.method === "POST") {
      (async () => {
        try {
          let payload: any;
          try {
            payload = await readJsonBody(req);
          } catch (parseErr: any) {
            const isTooLarge = parseErr?.message === "Payload Too Large";
            res.writeHead(isTooLarge ? 413 : 400, {
              "Content-Type": "application/json; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            });
            res.end(
              JSON.stringify({
                error: isTooLarge
                  ? "Payload Too Large"
                  : "Invalid comment payload: invalid JSON",
              })
            );
            return;
          }

          if (
            !payload ||
            typeof payload !== "object" ||
            typeof payload.text !== "string" ||
            !payload.text.trim()
          ) {
            res.writeHead(400, {
              "Content-Type": "application/json; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            });
            res.end(JSON.stringify({ error: "Missing required comment text" }));
            return;
          }

          const rawDoc =
            typeof payload.doc === "string" && payload.doc.trim()
              ? payload.doc.trim()
              : currentDiagrams[0]?.filename || "overview.md";

          if (
            rawDoc.includes("..") ||
            rawDoc.includes("/") ||
            rawDoc.includes("\\")
          ) {
            res.writeHead(400, {
              "Content-Type": "application/json; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            });
            res.end(JSON.stringify({ error: "Invalid doc parameter" }));
            return;
          }

          const doc = rawDoc;
          const threads = loadComments(options.projectRoot, doc);
          let targetThread: CommentThread | undefined;

          const msg: CommentMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            author: payload.author === "agent" ? "agent" : "user",
            text: payload.text.trim(),
            createdAt: Date.now(),
          };

          if (payload.id) {
            targetThread = threads.find((t) => t.id === payload.id);
          }

          if (targetThread) {
            targetThread.messages.push(msg);
            targetThread.updatedAt = Date.now();
          } else {
            const threadId =
              payload.id ||
              `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            targetThread = {
              id: threadId,
              doc,
              nodeId:
                typeof payload.nodeId === "string" && payload.nodeId.trim()
                  ? payload.nodeId.trim()
                  : undefined,
              x:
                typeof payload.x === "number" && !isNaN(payload.x)
                  ? payload.x
                  : 0,
              y:
                typeof payload.y === "number" && !isNaN(payload.y)
                  ? payload.y
                  : 0,
              status: "open",
              messages: [msg],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            threads.push(targetThread);
          }

          saveComments(options.projectRoot, doc, threads);

          // Bundle architectural context for long-poll bridge
          const diagram = currentDiagrams.find(
            (d) =>
              d.filename === doc || d.id === doc || d.filename === `${doc}.md`
          );

          let nodeContext: NodeContext | undefined;
          let matchingSection: DiagramSection | undefined;

          if (diagram && targetThread.nodeId) {
            nodeContext = extractNodeContext(
              diagram.mermaid,
              targetThread.nodeId
            );
            matchingSection = findMatchingSection(
              diagram,
              nodeContext.nodeId,
              nodeContext.label
            );
          }

          const listenEvent: ThreadListenEvent = {
            event: "comment_added",
            thread: targetThread,
            latestMessage: msg,
            context: {
              doc: targetThread.doc,
              diagramTitle: diagram?.title || targetThread.doc,
              mermaid: diagram?.mermaid || "",
              node: nodeContext,
              section: matchingSection,
            },
          };

          notifyWaiters(listenEvent);
          broadcastSSE({ type: "comment_added", thread: targetThread });
          broadcastSSE({ type: "agent_typing", commentId: targetThread.id });

          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify({ success: true, thread: targetThread }));
        } catch (err) {
          res.writeHead(500, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(
            JSON.stringify({ error: "Internal error processing comment" })
          );
        }
      })();
      return;
    }

    // GET /api/comments/poll: Long-poll endpoint
    if (pathname === "/api/comments/poll" && req.method === "GET") {
      try {
        const rawTimeout = parsedUrl.searchParams.get("timeout");
        const timeoutMs = rawTimeout
          ? Math.min(Math.max(parseInt(rawTimeout, 10) || 60000, 1000), 300000)
          : 60000;

        if (unhandledEvents.length > 0) {
          const ev = unhandledEvents.shift()!;
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify(ev));
          return;
        }

        let timer: NodeJS.Timeout | null = null;
        let isHandled = false;

        const waiter: LongPollWaiter = (ev) => {
          if (isHandled) return;
          isHandled = true;
          if (timer) clearTimeout(timer);
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify(ev));
        };

        pendingListenWaiters.push(waiter);

        timer = setTimeout(() => {
          if (isHandled) return;
          isHandled = true;
          const idx = pendingListenWaiters.indexOf(waiter);
          if (idx !== -1) {
            pendingListenWaiters.splice(idx, 1);
          }
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify({ event: "timeout" }));
        }, timeoutMs);

        req.on("close", () => {
          if (!isHandled) {
            isHandled = true;
            if (timer) clearTimeout(timer);
            const idx = pendingListenWaiters.indexOf(waiter);
            if (idx !== -1) {
              pendingListenWaiters.splice(idx, 1);
            }
          }
        });
      } catch (err) {
        res.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ error: "Internal error in comments poll" }));
      }
      return;
    }

    // POST /api/comments/:id/resolve: Mark thread as resolved
    const resolveMatch = pathname.match(
      /^\/api\/comments\/([^/]+)\/resolve\/?$/
    );
    if (resolveMatch && req.method === "POST") {
      (async () => {
        try {
          const commentId = decodeURIComponent(resolveMatch[1]);
          let payload: any = {};
          try {
            payload = await readJsonBody(req);
          } catch {}

          let targetDoc: string | undefined =
            typeof payload.doc === "string" ? payload.doc.trim() : undefined;
          let targetThread: CommentThread | undefined;
          let docThreads: CommentThread[] = [];

          if (targetDoc) {
            docThreads = loadComments(options.projectRoot, targetDoc);
            targetThread = docThreads.find((t) => t.id === commentId);
          }

          if (!targetThread) {
            for (const [docName, threadMap] of activeCommentThreads.entries()) {
              if (threadMap.has(commentId)) {
                targetThread = threadMap.get(commentId);
                targetDoc = docName;
                docThreads = Array.from(threadMap.values());
                break;
              }
            }
          }

          if (!targetThread) {
            for (const diag of currentDiagrams) {
              const loaded = loadComments(options.projectRoot, diag.filename);
              const match = loaded.find((t) => t.id === commentId);
              if (match) {
                targetThread = match;
                targetDoc = diag.filename;
                docThreads = loaded;
                break;
              }
            }
          }

          if (!targetThread || !targetDoc) {
            res.writeHead(404, {
              "Content-Type": "application/json; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            });
            res.end(JSON.stringify({ error: "Comment thread not found" }));
            return;
          }

          targetThread.status = "resolved";
          targetThread.updatedAt = Date.now();
          saveComments(options.projectRoot, targetDoc, docThreads);

          broadcastSSE({
            type: "thread_resolved",
            commentId: targetThread.id,
          });

          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(
            JSON.stringify({ success: true, commentId: targetThread.id })
          );
        } catch (err) {
          res.writeHead(500, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(
            JSON.stringify({ error: "Internal error resolving comment" })
          );
        }
      })();
      return;
    }

    // POST /api/session/end: Conclude session and notify long-poll bridge
    if (pathname === "/api/session/end" && req.method === "POST") {
      try {
        broadcastSSE({
          type: "session_ended",
          summary: "Session ended by user",
        });

        const listenEvent: ThreadListenEvent = {
          event: "session_ended",
          context: {
            doc: currentDiagrams[0]?.filename || "overview.md",
            diagramTitle: currentDiagrams[0]?.title || "Architecture Overview",
            mermaid: currentDiagrams[0]?.mermaid || "",
          },
        };
        notifyWaiters(listenEvent);

        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ success: true, message: "Session ended" }));
      } catch (err) {
        res.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ error: "Internal error ending session" }));
      }
      return;
    }

    // 404 for any other request
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  const port = await bindHttpServer(server, options.preferredPort);

  // Set up debounced file watcher with fs.watch
  let watcher: fs.FSWatcher | null = null;
  let debounceTimeout: NodeJS.Timeout | null = null;

  try {
    watcher = fs.watch(normalizedDir, (_eventType, filename) => {
      if (
        filename &&
        !filename.endsWith(".md") &&
        !filename.endsWith(".markdown")
      ) {
        return;
      }

      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }

      debounceTimeout = setTimeout(() => {
        try {
          const freshDiagrams = scanArchitectureDir(normalizedDir);
          const oldIds = new Set(currentDiagrams.map((d) => d.id));
          const newIds = new Set(freshDiagrams.map((d) => d.id));

          const dirChanged =
            oldIds.size !== newIds.size ||
            [...oldIds].some((id) => !newIds.has(id));

          if (dirChanged) {
            currentDiagrams = freshDiagrams;
            broadcastSSE({ type: "dir_change", diagrams: freshDiagrams });
            return;
          }

          // Check for individual file changes
          for (const newDiag of freshDiagrams) {
            const oldDiag = currentDiagrams.find((d) => d.id === newDiag.id);
            if (
              !oldDiag ||
              oldDiag.updatedAt !== newDiag.updatedAt ||
              oldDiag.mermaid !== newDiag.mermaid
            ) {
              broadcastSSE({
                type: "file_change",
                id: newDiag.id,
                diagram: newDiag,
              });
            }
          }
          currentDiagrams = freshDiagrams;
        } catch (err) {
          console.warn("[super-dev] Live watch scan error:", err);
        }
      }, 150);
      debounceTimeout.unref();
    });
  } catch (err) {
    console.warn(
      `[super-dev] Warning: Failed to initialize file watcher for ${normalizedDir}:`,
      err
    );
  }

  const instance: ArchServerInstance = {
    server,
    port,
    dirPath: normalizedDir,
    watcher,
    getDiagrams: () => currentDiagrams,
    broadcastSSE,
    close: async () => {
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }
      if (watcher) {
        try {
          watcher.close();
        } catch {}
        watcher = null;
      }
      for (const client of sseClients) {
        try {
          client.end();
        } catch {}
      }
      sseClients.clear();
      activeServers.delete(normalizedDir);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };

  activeServers.set(normalizedDir, instance);
  return instance;
}

/**
 * Stops an active preview server for a directory.
 */
export async function stopArchServer(dirPath: string): Promise<void> {
  const normalizedDir = path.normalize(path.resolve(dirPath));
  const instance = activeServers.get(normalizedDir);
  if (instance) {
    await instance.close();
  }
}

/**
 * Stops all currently running architecture preview servers.
 */
export async function stopAllArchServers(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const instance of activeServers.values()) {
    promises.push(instance.close());
  }
  await Promise.all(promises);
  activeServers.clear();
}

// ---------------------------------------------------------------------------
// Platform-Agnostic Browser Launch
// ---------------------------------------------------------------------------

/**
 * Opens a URL in the user's default browser across macOS, Linux, and Windows.
 * Never throws an unhandled rejection.
 */
export async function openBrowser(url: string): Promise<boolean> {
  // In test environment or if disabled, skip launching external browser
  if (
    process.env.NODE_ENV === "test" ||
    process.env.SUPER_DEV_NO_BROWSER === "true"
  ) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    try {
      const platform = process.platform;
      let cmd: string;
      let args: string[];

      if (platform === "darwin") {
        cmd = "open";
        args = [url];
      } else if (platform === "win32") {
        cmd = "cmd.exe";
        args = ["/c", "start", "", url];
      } else {
        cmd = "xdg-open";
        args = [url];
      }

      const child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
      });

      child.on("error", () => {
        resolve(false);
      });

      child.unref();
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}

// ---------------------------------------------------------------------------
// Architecture Discussion Archiver & History Helpers
// ---------------------------------------------------------------------------

/**
 * Parses YAML frontmatter and markdown body from an architecture discussion archive.
 */
export function parseDiscussionFrontmatter(content: string): {
  frontmatter: ArchitectureDiscussionFrontmatter;
  body: string;
} {
  const defaultFm: ArchitectureDiscussionFrontmatter = {
    title: "",
    date: "",
    doc: "",
    nodes: [],
    summary: "",
  };

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    const titleMatch = content.match(/^#\s+(.+)$/m);
    return {
      frontmatter: {
        ...defaultFm,
        title: titleMatch ? titleMatch[1].trim() : "Architecture Discussion",
      },
      body: content,
    };
  }

  const yaml = match[1];
  const body = match[2];
  const fm: ArchitectureDiscussionFrontmatter = { ...defaultFm };

  for (const line of yaml.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let val = line.slice(colonIdx + 1).trim();

    // Strip wrapping quotes if present
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      try {
        val = JSON.parse(val);
      } catch {
        val = val.slice(1, -1);
      }
    }

    if (key === "title") fm.title = val;
    else if (key === "date") fm.date = val;
    else if (key === "doc") fm.doc = val;
    else if (key === "summary") fm.summary = val;
    else if (key === "nodes") {
      try {
        const parsedNodes = JSON.parse(val);
        if (Array.isArray(parsedNodes)) {
          fm.nodes = parsedNodes.map((n) => String(n));
        }
      } catch {
        const trimmed = val.replace(/^\[|\]$/g, "").trim();
        fm.nodes = trimmed
          ? trimmed.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          : [];
      }
    }
  }

  return { frontmatter: fm, body };
}

/**
 * Appends or updates the '## Architecture Decision History' section in an architecture markdown file.
 */
export function appendDecisionHistory(content: string, entryLine: string): string {
  const heading = "## Architecture Decision History";
  const headingIdx = content.indexOf(heading);

  if (headingIdx === -1) {
    const trimmed = content.trimEnd();
    return `${trimmed}\n\n${heading}\n${entryLine}\n`;
  }

  // Find the end of this section (the next heading of level 1 or 2, or EOF)
  const afterHeading = content.slice(headingIdx + heading.length);
  const nextHeadingMatch = afterHeading.match(/\n(#{1,2}\s+[^\n]+)/);

  if (nextHeadingMatch && nextHeadingMatch.index !== undefined) {
    const insertIdx = headingIdx + heading.length + nextHeadingMatch.index;
    const before = content.slice(0, insertIdx).trimEnd();
    const after = content.slice(insertIdx).trimStart();
    return `${before}\n${entryLine}\n\n${after}`;
  } else {
    const before = content.trimEnd();
    return `${before}\n${entryLine}\n`;
  }
}

/**
 * Synthesizes clean title and summary for an architecture discussion session.
 */
export function synthesizeDiscussionMetadata(
  text: string | undefined,
  doc: string,
  discussedNodes: string[],
  threads: CommentThread[]
): { title: string; summary: string } {
  let title = "";
  let summary = "";
  const rawText = typeof text === "string" ? text.trim() : "";

  if (rawText) {
    const titleMatch = rawText.match(/(?:^|\n)(?:#\s*|Title:\s*)([^\n]+)/i);
    const summaryMatch = rawText.match(/(?:^|\n)(?:Summary:\s*)([^\n]+)/i);

    if (titleMatch) {
      title = titleMatch[1].trim();
    }
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    }

    if (!title) {
      const firstLine = rawText.split("\n")[0].trim().replace(/^[-*#>\s]+/, "");
      if (firstLine.length <= 80 && !firstLine.toLowerCase().startsWith("summary:")) {
        title = firstLine;
      } else {
        const sentenceEnd = firstLine.search(/[.!?]/);
        if (sentenceEnd > 0 && sentenceEnd <= 80) {
          title = firstLine.slice(0, sentenceEnd).trim();
        } else {
          title = firstLine.slice(0, 60).trim();
        }
      }
    }

    if (!summary) {
      const lines = rawText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const remainingLines = lines.filter(
        (l) =>
          !l.toLowerCase().startsWith("#") &&
          !l.toLowerCase().startsWith("title:") &&
          l !== title
      );
      if (remainingLines.length > 0) {
        summary = remainingLines.join(" ").replace(/^Summary:\s*/i, "").trim();
      } else {
        summary = rawText.replace(/^Summary:\s*/i, "").trim();
      }
    }
  }

  if (!title) {
    const baseDoc = doc.replace(/\.md$/, "");
    if (discussedNodes.length > 0) {
      title = `Architecture Review: ${discussedNodes.join(", ")}`;
    } else {
      title = `Architecture Discussion: ${baseDoc}`;
    }
  }

  if (!summary) {
    if (discussedNodes.length > 0) {
      summary = `Reviewed ${discussedNodes.join(", ")} in ${doc} and resolved architectural trade-offs.`;
    } else if (threads.length > 0) {
      summary = `Concluded architecture discussion session for ${doc} with ${threads.length} comment thread${threads.length > 1 ? "s" : ""}.`;
    } else {
      summary = `Architecture discussion session concluded for ${doc}.`;
    }
  }

  return { title, summary };
}

// ---------------------------------------------------------------------------
// MCP Tool Definition & Handler
// ---------------------------------------------------------------------------

export async function archViewHandler(
  args: Record<string, unknown>,
  ctx: AppContext
): Promise<ToolResult> {
  const action = typeof args.action === "string" ? args.action : "view";

  if (action === "listen") {
    const projectRoot = ctx.projectRoot;
    const config = getArchConfig(projectRoot);

    // Ensure preview server is running so comments can be received
    let targetPath: string;
    if (typeof args.source === "string" && args.source.trim().length > 0) {
      const rawSource = args.source.trim();
      const resolvedSource = path.resolve(projectRoot, rawSource);
      const relSource = path.relative(projectRoot, resolvedSource);
      if (
        relSource === ".." ||
        relSource.startsWith(".." + path.sep) ||
        path.isAbsolute(relSource)
      ) {
        return err(
          "Path traversal detected: source path must be within project root."
        );
      }
      targetPath = resolvedSource;
    } else {
      targetPath = path.resolve(projectRoot, config.source);
    }

    let dirPath = targetPath;
    if (fs.existsSync(targetPath)) {
      try {
        const stat = fs.statSync(targetPath);
        if (stat.isFile()) {
          dirPath = path.dirname(targetPath);
        }
      } catch {}
    }

    const normalizedDir = path.normalize(path.resolve(dirPath));
    let serverInstance = activeServers.get(normalizedDir);
    if (!serverInstance || !serverInstance.server.listening) {
      const preferredPort =
        typeof args.port === "number" && !isNaN(args.port)
          ? Math.floor(args.port)
          : undefined;
      try {
        serverInstance = await startArchServer({
          projectRoot,
          dirPath,
          preferredPort,
        });
      } catch {
        // Continue even if starting server fails (e.g. in unit tests)
      }
    }

    const defaultTimeout = process.env.NODE_ENV === "test" ? 50 : 60000;
    const timeoutMs =
      typeof args.timeout_ms === "number" &&
      !isNaN(args.timeout_ms) &&
      args.timeout_ms > 0
        ? Math.min(args.timeout_ms, 300000)
        : defaultTimeout;

    let event: ThreadListenEvent;
    if (unhandledEvents.length > 0) {
      event = unhandledEvents.shift()!;
    } else {
      event = await new Promise<ThreadListenEvent>((resolve) => {
        let timer: NodeJS.Timeout | null = null;
        let resolved = false;

        const waiter: LongPollWaiter = (ev) => {
          if (resolved) return;
          resolved = true;
          if (timer) clearTimeout(timer);
          resolve(ev);
        };

        pendingListenWaiters.push(waiter);

        timer = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          const idx = pendingListenWaiters.indexOf(waiter);
          if (idx !== -1) {
            pendingListenWaiters.splice(idx, 1);
          }
          resolve({ event: "timeout" });
        }, timeoutMs);
        timer.unref();
      });
    }

    if (
      event.event === "comment_added" &&
      event.thread &&
      event.latestMessage
    ) {
      const { thread, latestMessage, context } = event;
      const nodeInfo = context?.node;
      const sectionInfo = context?.section;

      let nodeSectionText = "";
      if (nodeInfo) {
        const labelPart = nodeInfo.label ? ` (${nodeInfo.label})` : "";
        const statusPart = nodeInfo.statusClass
          ? ` [Status: ${nodeInfo.statusClass}]`
          : "";
        const upstreamText =
          nodeInfo.upstreamNodes.length > 0
            ? nodeInfo.upstreamNodes.map((n) => `\`${n}\``).join(", ")
            : "none";
        const downstreamText =
          nodeInfo.downstreamNodes.length > 0
            ? nodeInfo.downstreamNodes.map((n) => `\`${n}\``).join(", ")
            : "none";

        nodeSectionText =
          `### Target Node Context\n` +
          `- **Node ID:** \`${nodeInfo.nodeId}\`${labelPart}${statusPart}\n` +
          `- **Upstream Connections:** ${upstreamText}\n` +
          `- **Downstream Connections:** ${downstreamText}\n\n`;
      } else if (thread.nodeId) {
        nodeSectionText = `### Target Node Context\n- **Node ID:** \`${thread.nodeId}\`\n\n`;
      } else {
        nodeSectionText = `### Target Node Context\n- **Canvas Location:** (${thread.x.toFixed(
          2
        )}, ${thread.y.toFixed(2)})\n\n`;
      }

      let sectionText = "";
      if (sectionInfo) {
        sectionText =
          `### Matching Section Specifications: ${sectionInfo.title}\n` +
          (sectionInfo.status ? `- **Status:** ${sectionInfo.status}\n` : "") +
          (sectionInfo.summary ? `- **Summary:** ${sectionInfo.summary}\n` : "") +
          (sectionInfo.rawContent
            ? `\n\`\`\`markdown\n${sectionInfo.rawContent}\n\`\`\`\n\n`
            : "\n");
      }

      let historyText = `### Thread Conversation History (${
        thread.messages.length
      } message${thread.messages.length > 1 ? "s" : ""})\n`;
      thread.messages.forEach((m, idx) => {
        const timeStr = new Date(m.createdAt).toLocaleTimeString();
        const authorName = m.author === "agent" ? "🤖 Agent" : "👤 User";
        historyText += `${idx + 1}. **${authorName}** (${timeStr}):\n   ${
          m.text
        }\n`;
      });

      const markdown =
        `## New Architecture Comment Received\n\n` +
        `- **Document:** \`${context?.doc || thread.doc}\`\n` +
        `- **Diagram:** ${context?.diagramTitle || thread.doc}\n` +
        `- **Thread ID:** \`${thread.id}\`\n` +
        `- **Status:** ${thread.status}\n\n` +
        `### Latest User Message\n> ${latestMessage.text}\n\n` +
        `${nodeSectionText}` +
        `${sectionText}` +
        `${historyText}\n` +
        `### Instructions\n` +
        `Analyze the question using the architectural context above. Reply directly on the canvas using:\n` +
        `\`\`\`json\n` +
        `{\n` +
        `  "action": "reply",\n` +
        `  "commentId": "${thread.id}",\n` +
        `  "text": "<your architectural critique or answer here>"\n` +
        `}\n` +
        `\`\`\``;

      return ok(markdown);
    }

    if (event.event === "session_ended") {
      return ok(
        `## Architecture Discussion Session Ended\n\n` +
          `The discussion session was concluded by the user from the browser canvas.\n\n` +
          `Call \`arch_view({ action: "end" })\` to generate and apply the Architecture Decision Record (ADR).`
      );
    }

    return ok(
      `## Listen Timeout\n\n` +
        `No new comments or session events received during the listen window (${timeoutMs}ms).\n\n` +
        `You can call \`arch_view({ action: "listen" })\` again to keep waiting or check in with the user.`
    );
  }

  if (action === "reply") {
    const projectRoot = ctx.projectRoot;
    const commentId =
      typeof args.commentId === "string" ? args.commentId.trim() : "";
    const replyText = typeof args.text === "string" ? args.text.trim() : "";

    if (!commentId) {
      return err("commentId and text are required for action: 'reply'.");
    }
    if (!replyText) {
      return err("text is required for action: 'reply'.");
    }

    let targetDoc: string | undefined =
      typeof args.doc === "string" && args.doc.trim()
        ? args.doc.trim()
        : undefined;
    let targetThread: CommentThread | undefined;
    let docThreads: CommentThread[] = [];

    if (targetDoc) {
      docThreads = loadComments(projectRoot, targetDoc);
      targetThread = docThreads.find((t) => t.id === commentId);
    }

    if (!targetThread) {
      for (const [docName, threadMap] of activeCommentThreads.entries()) {
        if (threadMap.has(commentId)) {
          targetThread = threadMap.get(commentId);
          targetDoc = docName;
          docThreads = Array.from(threadMap.values());
          break;
        }
      }
    }

    if (!targetThread) {
      const commentsDir = getCommentsDir(projectRoot);
      if (fs.existsSync(commentsDir)) {
        const files = fs
          .readdirSync(commentsDir)
          .filter((f) => f.endsWith(".json"));
        for (const file of files) {
          const loaded = loadComments(projectRoot, file);
          const match = loaded.find((t) => t.id === commentId);
          if (match) {
            targetThread = match;
            targetDoc = match.doc || file;
            docThreads = loaded;
            break;
          }
        }
      }
    }

    if (!targetThread || !targetDoc) {
      return err(`Comment thread '${commentId}' not found.`);
    }

    const message: CommentMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      author: "agent",
      text: replyText,
      createdAt: Date.now(),
    };

    targetThread.messages.push(message);
    targetThread.updatedAt = Date.now();

    saveComments(projectRoot, targetDoc, docThreads);

    broadcastToActiveServers({
      type: "agent_reply",
      commentId: targetThread.id,
      message,
    });

    return ok(
      `## Reply Sent to Canvas\n\n` +
        `- **Thread ID:** \`${targetThread.id}\`\n` +
        `- **Document:** \`${targetDoc}\`\n` +
        `- **Node:** ${
          targetThread.nodeId ? `\`${targetThread.nodeId}\`` : "Canvas Pin"
        }\n\n` +
        `### Agent Reply\n> ${message.text}\n\n` +
        `_The reply has been broadcast to connected browser clients via SSE and appended to the thread._`
    );
  }

  if (action === "end") {
    const projectRoot = ctx.projectRoot;
    const config = getArchConfig(projectRoot);

    let sourceDir = config.source;
    if (typeof args.source === "string" && args.source.trim().length > 0) {
      const rawSource = args.source.trim();
      const resolvedSource = path.resolve(projectRoot, rawSource);
      const relSource = path.relative(projectRoot, resolvedSource);
      if (
        !relSource.startsWith(".." + path.sep) &&
        relSource !== ".." &&
        !path.isAbsolute(relSource)
      ) {
        sourceDir = rawSource;
      }
    }

    let archDir = path.resolve(projectRoot, sourceDir);
    if (fs.existsSync(archDir)) {
      try {
        const stat = fs.statSync(archDir);
        if (stat.isFile()) {
          archDir = path.dirname(archDir);
        }
      } catch {}
    }

    let doc =
      typeof args.doc === "string" && args.doc.trim()
        ? args.doc.trim()
        : undefined;

    if (!doc) {
      const diagrams = fs.existsSync(archDir)
        ? scanArchitectureDir(archDir)
        : [];
      doc = diagrams[0]?.filename || "overview.md";
    }

    if (!doc.endsWith(".md") && !doc.includes(".")) {
      doc = `${doc}.md`;
    }

    const threads = loadComments(projectRoot, doc);
    const openThreads = threads.filter((t) => t.status === "open");
    const resolvedThreads = threads.filter((t) => t.status === "resolved");

    const discussedNodes = Array.from(
      new Set(
        threads
          .map((t) => t.nodeId)
          .filter((n): n is string => Boolean(n && n.trim().length > 0))
      )
    );

    const rawText = typeof args.text === "string" ? args.text.trim() : "";
    const { title, summary } = synthesizeDiscussionMetadata(
      rawText,
      doc,
      discussedNodes,
      threads
    );

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 50) || "discussion";

    const discussionsDir = path.join(archDir, "discussions");
    if (!fs.existsSync(discussionsDir)) {
      try {
        fs.mkdirSync(discussionsDir, { recursive: true });
      } catch (err) {
        console.error(`[super-dev] Failed to create discussions directory:`, err);
      }
    }

    let archiveFilename = `${dateStr}-${slug}.md`;
    let archiveFilePath = path.join(discussionsDir, archiveFilename);
    let counter = 2;
    while (fs.existsSync(archiveFilePath)) {
      archiveFilename = `${dateStr}-${slug}-${counter}.md`;
      archiveFilePath = path.join(discussionsDir, archiveFilename);
      counter++;
    }

    let keyDecisions = "";
    if (rawText && rawText.includes("\n- ")) {
      keyDecisions = rawText;
    } else if (rawText && rawText !== summary && rawText !== title) {
      keyDecisions = `- **Decision**: ${rawText}\n- **Scope**: Applied to components in \`${doc}\`.`;
    } else if (threads.length > 0) {
      keyDecisions = threads
        .map((t) => {
          const nodePart = t.nodeId ? `Node \`${t.nodeId}\`` : "Canvas Pin";
          const agentReply = [...t.messages].reverse().find((m) => m.author === "agent");
          if (agentReply) {
            return `- **${nodePart}**: ${agentReply.text.split("\n")[0]}`;
          }
          const userMsg = t.messages[0];
          if (userMsg) {
            return `- **${nodePart}**: Discussed "${userMsg.text.split("\n")[0]}"`;
          }
          return `- **${nodePart}**: Reviewed during session.`;
        })
        .join("\n");
    } else {
      keyDecisions = `- Validated architectural constraints and baseline interactions in \`${doc}\`.\n- No blocking trade-offs or architectural risks identified.`;
    }

    let transcriptMarkdown = "";
    if (threads.length === 0) {
      transcriptMarkdown = "_No comments were recorded during this discussion session._";
    } else {
      transcriptMarkdown = threads
        .map((t, idx) => {
          const nodeTitle = t.nodeId ? `Node \`${t.nodeId}\`` : "Canvas Pin";
          let block = `### Thread ${idx + 1}: ${nodeTitle}\n`;
          if (t.messages.length === 0) {
            block += "_No messages in this thread._";
          } else {
            block += t.messages
              .map((m) => {
                const author = m.author === "agent" ? "Agent" : "User";
                const formatted = m.text
                  .split("\n")
                  .map((line, i) => (i === 0 ? line : `  ${line}`))
                  .join("\n");
                return `- **${author}**: ${formatted}`;
              })
              .join("\n");
          }
          return block;
        })
        .join("\n\n");
    }

    const archiveContent =
      `---\n` +
      `title: ${JSON.stringify(title)}\n` +
      `date: ${dateStr}\n` +
      `doc: ${doc}\n` +
      `nodes: ${JSON.stringify(discussedNodes)}\n` +
      `summary: ${JSON.stringify(summary)}\n` +
      `---\n\n` +
      `# ${title}\n\n` +
      `**Date:** ${dateStr} | **Document:** \`${doc}\`\n\n` +
      `## Executive Summary\n` +
      `${summary}\n\n` +
      `## Key Decisions & Trade-offs\n` +
      `${keyDecisions}\n\n` +
      `## Discussion Transcript\n` +
      `${transcriptMarkdown}\n`;

    try {
      fs.writeFileSync(archiveFilePath, archiveContent, "utf-8");
    } catch (err) {
      console.error(`[super-dev] Failed to write discussion archive ${archiveFilePath}:`, err);
    }

    const targetDocPath = path.join(archDir, doc);
    const entryLine = `- **[${dateStr}] ${title}**: ${summary} ([Full Discussion](discussions/${archiveFilename}))`;

    if (fs.existsSync(targetDocPath)) {
      try {
        const existingContent = fs.readFileSync(targetDocPath, "utf-8");
        const updatedContent = appendDecisionHistory(existingContent, entryLine);
        fs.writeFileSync(targetDocPath, updatedContent, "utf-8");
      } catch (err) {
        console.error(`[super-dev] Failed to update decision history in ${targetDocPath}:`, err);
      }
    } else {
      try {
        if (!fs.existsSync(archDir)) {
          fs.mkdirSync(archDir, { recursive: true });
        }
        const baseTitle = doc.replace(/\.md$/, "");
        const initialContent = `# ${baseTitle}\n\n## Architecture Decision History\n${entryLine}\n`;
        fs.writeFileSync(targetDocPath, initialContent, "utf-8");
      } catch (err) {
        console.error(`[super-dev] Failed to create ${targetDocPath}:`, err);
      }
    }

    const relArchivePath = path.relative(projectRoot, archiveFilePath).replace(/\\/g, "/");
    const nodesText = discussedNodes.length > 0
      ? discussedNodes.map((n) => `\`${n}\``).join(", ")
      : "None";

    return ok(
      `## Architecture Discussion Concluded & Archived\n\n` +
        `- **Document:** \`${doc}\`\n` +
        `- **Archive:** \`${relArchivePath}\`\n` +
        `- **Title:** ${title}\n` +
        `- **Summary:** ${summary}\n` +
        `- **Nodes Discussed:** ${nodesText}\n` +
        `- **Total Threads:** ${threads.length} (${resolvedThreads.length} resolved, ${openThreads.length} open)\n\n` +
        `### Architecture Decision Record (ADR)\n` +
        `An entry has been recorded in \`${doc}\` under \`## Architecture Decision History\` linking to the archived discussion transcript.`
    );
  }

  if (action === "history") {
    const projectRoot = ctx.projectRoot;
    const config = getArchConfig(projectRoot);

    let sourceDir = config.source;
    if (typeof args.source === "string" && args.source.trim().length > 0) {
      const rawSource = args.source.trim();
      const resolvedSource = path.resolve(projectRoot, rawSource);
      const relSource = path.relative(projectRoot, resolvedSource);
      if (
        !relSource.startsWith(".." + path.sep) &&
        relSource !== ".." &&
        !path.isAbsolute(relSource)
      ) {
        sourceDir = rawSource;
      }
    }

    let archDir = path.resolve(projectRoot, sourceDir);
    if (fs.existsSync(archDir)) {
      try {
        const stat = fs.statSync(archDir);
        if (stat.isFile()) {
          archDir = path.dirname(archDir);
        }
      } catch {}
    }

    let discussionsDir = path.join(archDir, "discussions");
    if (!fs.existsSync(discussionsDir)) {
      const fallbackDiscussions = path.join(
        projectRoot,
        "docs",
        "architecture",
        "discussions"
      );
      if (fs.existsSync(fallbackDiscussions)) {
        discussionsDir = fallbackDiscussions;
      }
    }

    const relDiscussionsDir = path
      .relative(projectRoot, discussionsDir)
      .replace(/\\/g, "/");

    if (!fs.existsSync(discussionsDir)) {
      return ok(
        `## Architecture Discussion History\n\nNo discussion archives found in \`${relDiscussionsDir}\`.`
      );
    }

    let files: string[] = [];
    try {
      files = fs
        .readdirSync(discussionsDir)
        .filter((f) => f.endsWith(".md") && !f.startsWith("."));
    } catch {
      return ok(
        `## Architecture Discussion History\n\nNo discussion archives found in \`${relDiscussionsDir}\`.`
      );
    }

    if (files.length === 0) {
      return ok(
        `## Architecture Discussion History\n\nNo discussion records found in \`${relDiscussionsDir}\`.`
      );
    }

    interface DiscussionEntry {
      filename: string;
      relPath: string;
      title: string;
      date: string;
      doc: string;
      nodes: string[];
      summary: string;
      content: string;
    }

    const entries: DiscussionEntry[] = [];
    for (const file of files) {
      const fullPath = path.join(discussionsDir, file);
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        const { frontmatter } = parseDiscussionFrontmatter(content);

        let date = frontmatter.date;
        if (!date) {
          const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
          date = dateMatch ? dateMatch[1] : "";
        }

        let title = frontmatter.title;
        if (!title) {
          const headingMatch = content.match(/^#\s+(.+)$/m);
          title = headingMatch ? headingMatch[1].trim() : file.replace(/\.md$/, "");
        }

        let doc = frontmatter.doc;
        if (!doc) {
          const docMatch = content.match(/\*\*Document:\*\*\s*`?([^`\s\n|]+)`?/i);
          doc = docMatch ? docMatch[1].trim() : "";
        }

        let summary = frontmatter.summary;
        if (!summary) {
          const summaryMatch = content.match(/## Executive Summary\s*\n+([^\n#]+)/i);
          summary = summaryMatch ? summaryMatch[1].trim() : "";
        }

        entries.push({
          filename: file,
          relPath: path.relative(projectRoot, fullPath).replace(/\\/g, "/"),
          title,
          date,
          doc,
          nodes: frontmatter.nodes || [],
          summary,
          content,
        });
      } catch {}
    }

    // Sort newest first
    entries.sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) {
        return b.date.localeCompare(a.date);
      }
      return b.filename.localeCompare(a.filename);
    });

    let filtered = entries;

    // Filter by doc if provided
    if (typeof args.doc === "string" && args.doc.trim().length > 0) {
      const filterDoc = args.doc.trim().toLowerCase();
      const filterDocBase = filterDoc.replace(/\.md$/, "");
      filtered = filtered.filter((e) => {
        const eDoc = e.doc.toLowerCase();
        const eDocBase = eDoc.replace(/\.md$/, "");
        return (
          eDoc === filterDoc ||
          eDocBase === filterDocBase ||
          eDoc.includes(filterDocBase)
        );
      });
    }

    // Filter by query if provided
    if (typeof args.query === "string" && args.query.trim().length > 0) {
      const q = args.query.trim().toLowerCase();
      filtered = filtered.filter((e) => {
        return (
          e.title.toLowerCase().includes(q) ||
          e.summary.toLowerCase().includes(q) ||
          e.doc.toLowerCase().includes(q) ||
          e.nodes.some((n) => n.toLowerCase().includes(q)) ||
          e.content.toLowerCase().includes(q)
        );
      });
    }

    if (filtered.length === 0) {
      const filters: string[] = [];
      if (args.doc) filters.push(`document: \`${args.doc}\``);
      if (args.query) filters.push(`query: "${args.query}"`);
      const filterStr = filters.length > 0 ? ` matching ${filters.join(" and ")}` : "";
      return ok(
        `## Architecture Discussion History\n\nNo architecture discussions found${filterStr}.`
      );
    }

    const formattedList = filtered
      .map((e) => {
        const nodesText =
          e.nodes.length > 0
            ? e.nodes.map((n) => `\`${n}\``).join(", ")
            : "None";
        const datePrefix = e.date ? `[${e.date}] ` : "";
        return (
          `- **${datePrefix}${e.title}** (\`${e.doc || e.filename}\`)\n` +
          `  - **File:** \`${e.relPath}\`\n` +
          `  - **Summary:** ${e.summary || "No summary provided."}\n` +
          `  - **Nodes Discussed:** ${nodesText}`
        );
      })
      .join("\n\n");

    return ok(
      `## Architecture Discussion History (${filtered.length} record${
        filtered.length === 1 ? "" : "s"
      })\n\n${formattedList}`
    );
  }

  const projectRoot = ctx.projectRoot;
  const config = getArchConfig(projectRoot);

  // Validate and resolve source path
  let targetPath: string;
  if (typeof args.source === "string" && args.source.trim().length > 0) {
    const rawSource = args.source.trim();
    const resolvedSource = path.resolve(projectRoot, rawSource);
    const relSource = path.relative(projectRoot, resolvedSource);

    // Path traversal check
    if (
      relSource === ".." ||
      relSource.startsWith(".." + path.sep) ||
      path.isAbsolute(relSource)
    ) {
      return err("Path traversal detected: source path must be within project root.");
    }
    targetPath = resolvedSource;
  } else {
    targetPath = path.resolve(projectRoot, config.source);
  }

  // Determine containing directory and active document
  let dirPath = targetPath;
  let activeDocFilename: string | undefined =
    typeof args.doc === "string" && args.doc.trim().length > 0
      ? args.doc.trim()
      : undefined;

  // Validate activeDocFilename for path traversal
  if (activeDocFilename) {
    if (
      activeDocFilename.includes("..") ||
      activeDocFilename.includes("/") ||
      activeDocFilename.includes("\\")
    ) {
      return err(
        "Invalid doc parameter: must be a filename, not a relative path."
      );
    }
  }

  // If source points to a specific markdown file
  if (fs.existsSync(targetPath)) {
    try {
      const stat = fs.statSync(targetPath);
      if (stat.isFile()) {
        dirPath = path.dirname(targetPath);
        if (!activeDocFilename) {
          activeDocFilename = path.basename(targetPath);
        }
      }
    } catch {}
  }

  // If directory does not exist or has no markdown files, scaffold starter overview
  const hasExistingMd =
    fs.existsSync(dirPath) &&
    fs.readdirSync(dirPath).some((f) => f.endsWith(".md") && !f.startsWith("."));

  if (!hasExistingMd) {
    scaffoldArchitecture(projectRoot, dirPath, config.reference);
  }

  // Scan diagrams
  const diagrams = scanArchitectureDir(dirPath);
  if (diagrams.length === 0) {
    return err(`No architecture markdown files found in ${dirPath}.`);
  }

  // Determine active diagram
  let activeDiagram: ArchitectureDiagram = diagrams[0];
  if (activeDocFilename) {
    const match = diagrams.find(
      (d) =>
        d.filename === activeDocFilename ||
        d.id === activeDocFilename ||
        d.filename === `${activeDocFilename}.md`
    );
    if (match) {
      activeDiagram = match;
    }
  }

  // Start or retrieve running preview server
  let instance: ArchServerInstance;
  try {
    const preferredPort =
      typeof args.port === "number" && !isNaN(args.port)
        ? Math.floor(args.port)
        : undefined;
    instance = await startArchServer({
      projectRoot,
      dirPath,
      preferredPort,
    });
  } catch (serverErr) {
    return err(
      `Failed to launch architecture preview server: ${
        serverErr instanceof Error ? serverErr.message : String(serverErr)
      }`
    );
  }

  const previewUrl = `http://127.0.0.1:${instance.port}/?doc=${encodeURIComponent(
    activeDiagram.filename
  )}`;

  // Launch browser (never fails the tool response)
  await openBrowser(previewUrl);

  // Return formatted response
  const diagramsList = diagrams
    .map(
      (d) =>
        `- ${d.id === activeDiagram.id ? "[x]" : "[ ]"} **${d.title}** (\`${d.filename}\`)`
    )
    .join("\n");

  const relDirPath = path.relative(projectRoot, dirPath) || ".";

  return ok(
    `## Architecture Viewer Launched\n\n` +
      `- **Preview URL:** ${previewUrl}\n` +
      `- **Active Document:** ${activeDiagram.title} (\`${activeDiagram.filename}\`)\n` +
      `- **Architecture Directory:** \`${relDirPath}\`\n\n` +
      `### Available Diagrams (${diagrams.length})\n` +
      `${diagramsList}\n\n` +
      `_Live reload is active. Edits to diagrams will update in real-time._`
  );
}

export const archViewSchema = {
  action: z
    .enum(["view", "listen", "reply", "end", "history"])
    .optional()
    .default("view")
    .describe(
      "Action to perform: 'view' (launch viewer), 'listen' (wait for browser comment), 'reply' (post agent response), 'end' (finish session & get ADR summary), 'history' (list past architecture discussions)."
    ),
  doc: z
    .string()
    .optional()
    .describe("Target diagram filename (e.g. 'overview.md')."),
  source: z
    .string()
    .optional()
    .describe(
      "Directory or file path for architecture docs. Overrides default 'docs/architecture'."
    ),
  port: z
    .number()
    .optional()
    .describe("Preferred port for preview server."),
  commentId: z
    .string()
    .optional()
    .describe("Target comment thread ID for 'reply' action."),
  text: z
    .string()
    .optional()
    .describe("Reply text, feedback content, or ADR synthesis summary."),
  timeout_ms: z
    .number()
    .optional()
    .describe(
      "Long-poll timeout in milliseconds for 'listen' action (default: 60000ms)."
    ),
  query: z
    .string()
    .optional()
    .describe(
      "Case-insensitive search query to filter discussions for 'history' action."
    ),
};

export const archTools: ToolDef[] = [
  {
    name: "arch_view",
    description:
      "Launch interactive architecture diagram viewer in browser with multi-diagram sidebar, pan/zoom canvas, live reload, and side-by-side node inspector.",
    schema: archViewSchema,
    handler: archViewHandler,
  },
];
