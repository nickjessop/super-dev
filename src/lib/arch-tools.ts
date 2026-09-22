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
} from "../types.js";
import { ok, err } from "../types.js";
import { getArchConfig } from "./settings.js";

export type {
  ArchitectureDiagram,
  DiagramSection,
  ViewerInitialPayload,
  ArchServerEvent,
};

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

  function broadcastSSE(event: ArchServerEvent) {
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
// MCP Tool Definition & Handler
// ---------------------------------------------------------------------------

export async function archViewHandler(
  args: Record<string, unknown>,
  ctx: AppContext
): Promise<ToolResult> {
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

export const archTools: ToolDef[] = [
  {
    name: "arch_view",
    description:
      "Launch interactive architecture diagram viewer in browser with multi-diagram sidebar, pan/zoom canvas, live reload, and side-by-side node inspector.",
    schema: {
      doc: z
        .string()
        .optional()
        .describe(
          "Specific diagram filename (e.g. 'credit-pipeline.md') to open as active."
        ),
      source: z
        .string()
        .optional()
        .describe(
          "Directory or file path for architecture documentation. Overrides default 'docs/architecture'."
        ),
      port: z
        .number()
        .optional()
        .describe(
          "Preferred port for preview server (defaults to ephemeral available port)."
        ),
    },
    handler: archViewHandler,
  },
];
