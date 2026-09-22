import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Prevent actual browser windows from popping up during test runs
process.env.NODE_ENV = "test";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  parseArchitectureMarkdown,
  scanArchitectureDir,
  scaffoldArchitecture,
  ensureAgentsReference,
  startArchServer,
  stopArchServer,
  stopAllArchServers,
  openBrowser,
  archViewHandler,
  archTools,
  archViewSchema,
  loadComments,
  saveComments,
  getCommentsDir,
  getCommentFilePath,
  activeCommentThreads,
  clearCommentCache,
  clearLongPollWaiters,
  STARTER_OVERVIEW_TEMPLATE,
  parseDiscussionFrontmatter,
  appendDecisionHistory,
  synthesizeDiscussionMetadata,
} from "../src/lib/arch-tools.js";
import type { AppContext, CommentThread } from "../src/types.js";

function createTempProject(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "super-dev-arch-test-"));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// Task 3.1: Scaffolding and Markdown Parser Tests
// ---------------------------------------------------------------------------

test("Task 3.1: scaffoldArchitecture creates overview.md and updates AGENTS.md", () => {
  const { root, cleanup } = createTempProject();
  try {
    const archDir = join(root, "docs", "architecture");
    assert.strictEqual(existsSync(archDir), false);

    const scaffolded = scaffoldArchitecture(root, archDir, "AGENTS.md");
    assert.strictEqual(scaffolded, true);
    assert.strictEqual(existsSync(archDir), true);

    const overviewFile = join(archDir, "overview.md");
    assert.strictEqual(existsSync(overviewFile), true);
    const content = readFileSync(overviewFile, "utf-8");
    assert.strictEqual(content, STARTER_OVERVIEW_TEMPLATE);

    // AGENTS.md should have been created with reference link
    const agentsFile = join(root, "AGENTS.md");
    assert.strictEqual(existsSync(agentsFile), true);
    const agentsContent = readFileSync(agentsFile, "utf-8");
    assert.ok(agentsContent.includes("## Project Reference Docs"));
    assert.ok(agentsContent.includes("- [Architecture Overview](docs/architecture/overview.md)"));
  } finally {
    cleanup();
  }
});

test("Task 3.1: ensureAgentsReference updates existing AGENTS.md cleanly without duplication", () => {
  const { root, cleanup } = createTempProject();
  try {
    const agentsFile = join(root, "AGENTS.md");
    writeFileSync(
      agentsFile,
      "# My Project\n\nSome guidelines here.\n\n## Project Reference Docs\n- [Existing Doc](docs/existing.md)\n",
      "utf-8"
    );

    ensureAgentsReference(root, "docs/architecture/overview.md", "AGENTS.md");
    let content = readFileSync(agentsFile, "utf-8");
    assert.ok(content.includes("- [Architecture Overview](docs/architecture/overview.md)"));
    assert.ok(content.includes("- [Existing Doc](docs/existing.md)"));

    // Call again to ensure idempotency (no duplicates)
    ensureAgentsReference(root, "docs/architecture/overview.md", "AGENTS.md");
    content = readFileSync(agentsFile, "utf-8");
    const occurrences = content.split("- [Architecture Overview](docs/architecture/overview.md)").length - 1;
    assert.strictEqual(occurrences, 1);
  } finally {
    cleanup();
  }
});

test("Task 3.1: parseArchitectureMarkdown extracts frontmatter title, mermaid block, and sections", () => {
  const sampleMarkdown = `---
title: Credit Pipeline Architecture
---

# Credit Pipeline Architecture

\`\`\`mermaid
flowchart LR
  Ingest[Data Ingest]:::existing --> Validator[Credit Validator]:::new
\`\`\`

## 1. Data Ingest
Status: existing
Summary: Streams incoming credit requests from edge nodes.
Detailed notes about data ingest.

## 2. Credit Validator
Status: new
Summary: Evaluates transaction limits and risk scoring.
Validation logic documentation.

### Sub-System Rules
Status: deprecated
Summary: Legacy scoring heuristics.
`;

  const diagram = parseArchitectureMarkdown(
    sampleMarkdown,
    "credit-pipeline.md",
    123456
  );

  assert.strictEqual(diagram.id, "credit-pipeline");
  assert.strictEqual(diagram.filename, "credit-pipeline.md");
  assert.strictEqual(diagram.title, "Credit Pipeline Architecture");
  assert.strictEqual(diagram.updatedAt, 123456);
  assert.ok(diagram.mermaid.includes("flowchart LR"));
  assert.ok(diagram.mermaid.includes("Data Ingest"));

  // Check section 1
  const sec1 = diagram.sections["1"];
  assert.ok(sec1, "Section 1 should exist by numeric id");
  assert.strictEqual(sec1.title, "1. Data Ingest");
  assert.strictEqual(sec1.status, "existing");
  assert.strictEqual(sec1.summary, "Streams incoming credit requests from edge nodes.");
  assert.ok(diagram.sections["Data Ingest"], "Should be indexed by stripped title");
  assert.ok(diagram.sections["data-ingest"], "Should be indexed by slug");

  // Check section 2
  const sec2 = diagram.sections["2"];
  assert.ok(sec2);
  assert.strictEqual(sec2.status, "new");
  assert.strictEqual(sec2.summary, "Evaluates transaction limits and risk scoring.");

  // Check sub-system section
  const sec3 = diagram.sections["sub-system-rules"];
  assert.ok(sec3);
  assert.strictEqual(sec3.status, "deprecated");
});

test("Task 3.1: parseArchitectureMarkdown fallback behavior for missing frontmatter or mermaid", () => {
  const noFrontmatter = `# Fallback Heading\n\nSome body text without mermaid.`;
  const diag1 = parseArchitectureMarkdown(noFrontmatter, "custom-doc.md");
  assert.strictEqual(diag1.title, "Fallback Heading");
  assert.ok(diag1.mermaid.includes("No Mermaid diagram defined in custom-doc.md"));

  const noHeading = `Just body text with no heading.`;
  const diag2 = parseArchitectureMarkdown(noHeading, "my-diagram.md");
  assert.strictEqual(diag2.title, "my-diagram");
});

test("Task 3.1: scanArchitectureDir discovers all .md files and prioritizes overview.md", () => {
  const { root, cleanup } = createTempProject();
  try {
    const archDir = join(root, "docs", "architecture");
    mkdirSync(archDir, { recursive: true });

    writeFileSync(join(archDir, "zeta.md"), "# Zeta Flow\n```mermaid\nflowchart TD\n  Z-->A\n```", "utf-8");
    writeFileSync(join(archDir, "alpha.md"), "# Alpha Flow\n```mermaid\nflowchart TD\n  A-->B\n```", "utf-8");
    writeFileSync(join(archDir, "overview.md"), "# Overview System\n```mermaid\nflowchart TD\n  O-->P\n```", "utf-8");
    writeFileSync(join(archDir, "ignored.txt"), "not markdown", "utf-8");

    const diagrams = scanArchitectureDir(archDir);
    assert.strictEqual(diagrams.length, 3);
    assert.strictEqual(diagrams[0].id, "overview");
    assert.strictEqual(diagrams[1].id, "alpha");
    assert.strictEqual(diagrams[2].id, "zeta");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Task 3.2: Native Node.js HTTP Server & Debounced SSE Live Watcher Tests
// ---------------------------------------------------------------------------

function httpRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res: http.IncomingMessage) => {
        let data = "";
        res.on("data", (chunk: Buffer | string) => (data += chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: data,
          });
        });
      }
    );
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function httpGet(url: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return httpRequest(url, { method: "GET" });
}

test("Task 3.2: startArchServer binds to 127.0.0.1 and serves GET / and GET /api/diagrams", async () => {
  const { root, cleanup } = createTempProject();
  try {
    const archDir = join(root, "docs", "architecture");
    scaffoldArchitecture(root, archDir);

    const instance = await startArchServer({
      projectRoot: root,
      dirPath: archDir,
    });

    assert.ok(instance.port > 0);
    const addr = instance.server.address();
    assert.ok(typeof addr === "object" && addr !== null);
    assert.strictEqual(addr.address, "127.0.0.1");

    // 1. Test GET /
    const homeRes = await httpGet(`http://127.0.0.1:${instance.port}/`);
    assert.strictEqual(homeRes.statusCode, 200);
    assert.ok(homeRes.headers["content-type"]?.includes("text/html"));
    assert.ok(homeRes.body.includes('<script id="arch-data" type="application/json">'));
    assert.ok(homeRes.body.includes('"activeId": "overview"'));

    // 2. Test GET /api/diagrams
    const apiRes = await httpGet(`http://127.0.0.1:${instance.port}/api/diagrams`);
    assert.strictEqual(apiRes.statusCode, 200);
    assert.ok(apiRes.headers["content-type"]?.includes("application/json"));
    const apiData = JSON.parse(apiRes.body);
    assert.ok(Array.isArray(apiData));
    assert.strictEqual(apiData.length, 1);
    assert.strictEqual(apiData[0].id, "overview");

    await stopArchServer(archDir);
  } finally {
    await stopAllArchServers();
    cleanup();
  }
});

test("Task 3.2: server automatically closes after inactivity timeout when no browser tabs are open", async () => {
  const { root, cleanup } = createTempProject();
  try {
    const archDir = join(root, "docs", "architecture");
    scaffoldArchitecture(root, archDir);

    const instance = await startArchServer({
      projectRoot: root,
      dirPath: archDir,
      inactivityTimeoutMs: 60, // 60ms for fast test
    });

    assert.ok(instance.server.listening, "Server should initially be listening");
    assert.strictEqual(instance.port > 0, true);

    // Wait 90ms for inactivity timer to fire
    await new Promise((resolve) => setTimeout(resolve, 90));

    assert.strictEqual(instance.server.listening, false, "Server should have automatically closed due to inactivity");
  } finally {
    await stopAllArchServers();
    cleanup();
  }
});

test("Task 3.2: startArchServer SSE stream receives live file updates", async () => {
  const { root, cleanup } = createTempProject();
  try {
    const archDir = join(root, "docs", "architecture");
    scaffoldArchitecture(root, archDir);

    const instance = await startArchServer({
      projectRoot: root,
      dirPath: archDir,
    });

    // Connect to SSE stream
    const sseEvents: string[] = [];
    const sseReq = http.get(`http://127.0.0.1:${instance.port}/events`, (res: http.IncomingMessage) => {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers["content-type"], "text/event-stream");
      res.on("data", (chunk: Buffer | string) => {
        sseEvents.push(chunk.toString());
      });
    });

    // Wait 50ms for SSE connection to establish
    await new Promise((r) => setTimeout(r, 50));

    // Modify overview.md to trigger watcher debounce (150ms)
    const overviewFile = join(archDir, "overview.md");
    const updatedContent = readFileSync(overviewFile, "utf-8") + "\n## 5. Extra Worker\nStatus: new\n";
    writeFileSync(overviewFile, updatedContent, "utf-8");

    // Wait 250ms for debounce and broadcast
    await new Promise((r) => setTimeout(r, 250));

    sseReq.destroy();
    await stopArchServer(archDir);

    const fullSseOutput = sseEvents.join("");
    assert.ok(fullSseOutput.includes(": connected"), "Should have sent connected handshake");
    assert.ok(
      fullSseOutput.includes('"type":"file_change"') || fullSseOutput.includes('"type":"dir_change"'),
      "Should have pushed live SSE change event"
    );
  } finally {
    await stopAllArchServers();
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Task 3.3: Platform-Agnostic Browser Launch & archViewHandler Tests
// ---------------------------------------------------------------------------

test("Task 3.3: openBrowser handles errors gracefully without throwing or rejecting", async () => {
  // Test with invalid URL or non-browser target — must resolve boolean false without throw
  const result = await openBrowser("http://127.0.0.1:999999/invalid");
  assert.strictEqual(typeof result, "boolean");
});

test("Task 3.3: archViewHandler launches viewer and returns preview URL and document list", async () => {
  const { root, cleanup } = createTempProject();
  try {
    const ctx: AppContext = { projectRoot: root };

    const result = await archViewHandler({}, ctx);
    assert.strictEqual(result.isError, undefined);
    assert.strictEqual(result.content.length, 1);
    const text = result.content[0].text;

    assert.ok(text.includes("Architecture Viewer Launched"));
    assert.ok(text.includes("- **Preview URL:** http://127.0.0.1:"));
    assert.ok(text.includes("Active Document:"));
    assert.ok(text.includes("Available Diagrams (1)"));
    assert.ok(text.includes("[x] **System Architecture Overview**"));

    // Check with explicit doc argument
    const result2 = await archViewHandler({ doc: "overview.md" }, ctx);
    assert.strictEqual(result2.isError, undefined);
    assert.ok(result2.content[0].text.includes("**Active Document:** System Architecture Overview"));
  } finally {
    await stopAllArchServers();
    cleanup();
  }
});

test("Task 3.3: archViewHandler rejects path traversal attempts in source and doc", async () => {
  const { root, cleanup } = createTempProject();
  try {
    const ctx: AppContext = { projectRoot: root };

    // Escaping project root via source
    const res1 = await archViewHandler({ source: "../../etc" }, ctx);
    assert.strictEqual(res1.isError, true);
    assert.ok(res1.content[0].text.includes("Path traversal detected"));

    // Path traversal in doc argument
    const res2 = await archViewHandler({ doc: "../secret.md" }, ctx);
    assert.strictEqual(res2.isError, true);
    assert.ok(res2.content[0].text.includes("Invalid doc parameter"));
  } finally {
    await stopAllArchServers();
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Task 4.1 & 4.3: MCP Tool Registration & Feature Group Tests
// ---------------------------------------------------------------------------

test("Task 4.1: archTools exports arch_view ToolDef with schema and handler", () => {
  assert.strictEqual(archTools.length, 1);
  const tool = archTools[0];
  assert.strictEqual(tool.name, "arch_view");
  assert.ok(tool.description.includes("architecture diagram viewer"));
  assert.ok(tool.schema.doc);
  assert.ok(tool.schema.source);
  assert.ok(tool.schema.port);
  assert.strictEqual(tool.handler, archViewHandler);
});

// ---------------------------------------------------------------------------
// Wave 1: arch-live-discuss Tests (Task 1.1 & Task 1.2)
// ---------------------------------------------------------------------------

test("Task 1.1: archViewSchema validates action enum and defaults to view", () => {
  const schemaObj = z.object(archViewSchema);

  // 1. Default action is "view" when parsed with empty object
  const parsedDefault = schemaObj.parse({});
  assert.strictEqual(parsedDefault.action, "view");

  // 2. All valid actions parse correctly
  assert.strictEqual(schemaObj.parse({ action: "view" }).action, "view");
  assert.strictEqual(schemaObj.parse({ action: "listen" }).action, "listen");
  assert.strictEqual(schemaObj.parse({ action: "reply" }).action, "reply");
  assert.strictEqual(schemaObj.parse({ action: "end" }).action, "end");
  assert.strictEqual(schemaObj.parse({ action: "history" }).action, "history");
  assert.strictEqual(schemaObj.parse({ action: "history", query: "redis" }).query, "redis");

  // 3. Invalid action throws validation error
  assert.throws(() => {
    schemaObj.parse({ action: "unknown_action" });
  });

  // 4. Optional fields parse properly
  const fullArgs = {
    action: "reply" as const,
    doc: "overview.md",
    source: "docs/architecture",
    port: 3344,
    commentId: "c-123",
    text: "Here is agent response",
    timeout_ms: 10000,
  };
  const parsedFull = schemaObj.parse(fullArgs);
  assert.strictEqual(parsedFull.action, "reply");
  assert.strictEqual(parsedFull.doc, "overview.md");
  assert.strictEqual(parsedFull.source, "docs/architecture");
  assert.strictEqual(parsedFull.port, 3344);
  assert.strictEqual(parsedFull.commentId, "c-123");
  assert.strictEqual(parsedFull.text, "Here is agent response");
  assert.strictEqual(parsedFull.timeout_ms, 10000);

  // 5. archTools[0].schema matches archViewSchema
  assert.strictEqual(archTools[0].schema, archViewSchema);
});

test("Task 1.1: archViewHandler handles listen, reply, end stubs cleanly while preserving view behavior", async () => {
  const { root, cleanup } = createTempProject();
  try {
    const ctx: AppContext = { projectRoot: root };

    // listen stub with short timeout for test
    const listenRes = await archViewHandler({ action: "listen", timeout_ms: 20 }, ctx);
    assert.strictEqual(listenRes.isError, undefined);
    assert.ok(
      listenRes.content[0].text.toLowerCase().includes("listen") ||
      listenRes.content[0].text.toLowerCase().includes("timeout")
    );

    // reply action with existing thread
    saveComments(root, "overview.md", [
      {
        id: "c-1",
        doc: "overview.md",
        x: 0,
        y: 0,
        status: "open",
        messages: [{ id: "m-1", author: "user", text: "question", createdAt: Date.now() }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    const replyRes = await archViewHandler({ action: "reply", commentId: "c-1", text: "ok", doc: "overview.md" }, ctx);
    assert.strictEqual(replyRes.isError, undefined);
    assert.ok(replyRes.content[0].text.toLowerCase().includes("reply"));

    // Auto-detect reply when action is omitted or defaulted to view
    const autoReply1 = await archViewHandler({ commentId: "c-1", text: "auto-reply omitted", doc: "overview.md" }, ctx);
    assert.strictEqual(autoReply1.isError, undefined);
    assert.ok(autoReply1.content[0].text.toLowerCase().includes("reply"));

    const autoReply2 = await archViewHandler({ action: "view", commentId: "c-1", text: "auto-reply with view action", doc: "overview.md" }, ctx);
    assert.strictEqual(autoReply2.isError, undefined);
    assert.ok(autoReply2.content[0].text.toLowerCase().includes("reply"));

    // end stub
    const endRes = await archViewHandler({ action: "end" }, ctx);
    assert.strictEqual(endRes.isError, undefined);
    assert.ok(endRes.content[0].text.toLowerCase().includes("end") || endRes.content[0].text.toLowerCase().includes("concluded"));
  } finally {
    await stopAllArchServers();
    cleanup();
  }
});

test("Task 1.2: loadComments and saveComments handle caching and disk persistence to .zed/super-dev/comments/<doc>.json", () => {
  const { root, cleanup } = createTempProject();
  try {
    clearCommentCache();

    // 1. Loading comments for a new/empty document returns empty array
    const emptyThreads = loadComments(root, "overview.md");
    assert.deepEqual(emptyThreads, []);

    // 2. Saving comments persists to .zed/super-dev/comments/<doc>.json
    const sampleThread: CommentThread = {
      id: "thread-1",
      doc: "overview.md",
      nodeId: "API Gateway",
      x: 0.45,
      y: 0.32,
      status: "open",
      messages: [
        {
          id: "msg-1",
          author: "user",
          text: "Can we decouple this via message queue?",
          createdAt: 1726000000,
        },
      ],
      createdAt: 1726000000,
      updatedAt: 1726000000,
    };

    saveComments(root, "overview.md", [sampleThread]);

    // Check disk file existence
    const commentsDir = getCommentsDir(root);
    assert.ok(existsSync(commentsDir), "comments directory must exist");
    const expectedFilePath = getCommentFilePath(root, "overview.md");
    assert.ok(existsSync(expectedFilePath), "overview comment file must exist on disk");

    const fileContent = readFileSync(expectedFilePath, "utf-8");
    assert.ok(fileContent.endsWith("\n"), "file should end with newline");
    const parsedOnDisk = JSON.parse(fileContent);
    assert.strictEqual(parsedOnDisk.length, 1);
    assert.strictEqual(parsedOnDisk[0].id, "thread-1");
    assert.strictEqual(parsedOnDisk[0].messages[0].text, "Can we decouple this via message queue?");

    // 3. Verify in-memory cache is populated
    assert.ok(activeCommentThreads.has("overview.md"));
    const cachedThread = activeCommentThreads.get("overview.md")?.get("thread-1");
    assert.ok(cachedThread);
    assert.strictEqual(cachedThread.nodeId, "API Gateway");

    // 4. Loading comments retrieves from in-memory cache
    const loadedFromCache = loadComments(root, "overview.md");
    assert.strictEqual(loadedFromCache.length, 1);
    assert.strictEqual(loadedFromCache[0].id, "thread-1");

    // 5. Clear cache and verify loading re-populates from disk
    clearCommentCache();
    assert.strictEqual(activeCommentThreads.size, 0);
    const loadedFromDisk = loadComments(root, "overview.md");
    assert.strictEqual(loadedFromDisk.length, 1);
    assert.strictEqual(loadedFromDisk[0].id, "thread-1");
    assert.ok(activeCommentThreads.has("overview.md"));

    // 6. Graceful handling of corrupted JSON file on disk
    writeFileSync(expectedFilePath, "{ not valid json !!!", "utf-8");
    clearCommentCache();
    const loadedCorrupt = loadComments(root, "overview.md");
    assert.deepEqual(loadedCorrupt, [], "Corrupted JSON should return empty array without throwing");

    // 7. Graceful handling of disk errors (e.g. unwritable location)
    assert.doesNotThrow(() => {
      saveComments("/dev/null/forbidden/path", "doc.md", [sampleThread]);
    });
  } finally {
    clearCommentCache();
    cleanup();
  }
});

test("Task 4.1 & 4.3: MCP tool arch_view and prompt arch are registered and respect SUPER_DEV_DISABLE=arch", () => {
  // 1. Verify archTools export
  assert.ok(archTools.some((t) => t.name === "arch_view"), "arch_view must be in archTools");

  // 2. Verify prompts/arch.md exists and has valid title
  const archPromptPath = join(process.cwd(), "prompts", "arch.md");
  assert.ok(existsSync(archPromptPath), "prompts/arch.md must exist");
  const promptContent = readFileSync(archPromptPath, "utf-8");
  assert.ok(promptContent.startsWith("# "), "prompts/arch.md must start with # title");

  // 3. Verify TOOL_GROUPS and PROMPT_GROUPS mappings in src/index.ts
  const indexContent = readFileSync(join(process.cwd(), "src", "index.ts"), "utf-8");
  assert.ok(indexContent.includes('arch_view: "arch"'), 'TOOL_GROUPS must map arch_view to "arch"');
  assert.ok(indexContent.includes('"arch": "arch"'), 'PROMPT_GROUPS must map arch to "arch"');
});

test("Task 2.1 & 2.2: comment REST API endpoints and long-poll bridge with rich context", async () => {
  const { root, cleanup } = createTempProject();
  try {
    const archDir = join(root, "docs", "architecture");
    scaffoldArchitecture(root, archDir);

    const instance = await startArchServer({
      projectRoot: root,
      dirPath: archDir,
    });

    const baseUrl = `http://127.0.0.1:${instance.port}`;

    // 1. Test POST /api/comments
    const postPayload = {
      doc: "overview.md",
      nodeId: "API Gateway",
      text: "Can we decouple this via message queue?",
      x: 100,
      y: 200,
    };
    const postRes = await httpRequest(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postPayload),
    });
    assert.strictEqual(postRes.statusCode, 200);
    const postJson = JSON.parse(postRes.body);
    assert.strictEqual(postJson.success, true);
    assert.ok(postJson.thread.id);
    const threadId = postJson.thread.id;

    // 2. Test GET /api/comments?doc=overview.md
    const getRes = await httpRequest(`${baseUrl}/api/comments?doc=overview.md`);
    assert.strictEqual(getRes.statusCode, 200);
    const getJson = JSON.parse(getRes.body);
    assert.strictEqual(getJson.length, 1);
    assert.strictEqual(getJson[0].id, threadId);

    // 3. Test long-poll bridge with action: "listen" and rich context
    clearLongPollWaiters();
    const ctx: AppContext = { projectRoot: root };
    const listenPromise = archViewHandler({ action: "listen", timeout_ms: 1000 }, ctx);

    // Short delay to ensure waiter is active
    await new Promise((r) => setTimeout(r, 20));

    await httpRequest(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: threadId,
        doc: "overview.md",
        text: "What queue technology do you recommend?",
      }),
    });

    const listenResult = await listenPromise;
    assert.strictEqual(listenResult.isError, undefined);
    const listenText = listenResult.content[0].text;
    assert.ok(listenText.includes("New Architecture Comment Received"));
    assert.ok(listenText.includes("API Gateway") || listenText.includes("API"));
    assert.ok(listenText.includes("What queue technology do you recommend?"));

    // 4. Test action: "reply"
    const replyRes = await archViewHandler(
      { action: "reply", commentId: threadId, text: "We recommend Redis Streams or Kafka depending on volume.", doc: "overview.md" },
      ctx
    );
    assert.strictEqual(replyRes.isError, undefined);
    assert.ok(replyRes.content[0].text.includes("Reply Sent to Canvas"));

    // 5. Test POST /api/comments/:id/resolve
    const resolveRes = await httpRequest(`${baseUrl}/api/comments/${threadId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc: "overview.md" }),
    });
    assert.strictEqual(resolveRes.statusCode, 200);
    const resolveJson = JSON.parse(resolveRes.body);
    assert.strictEqual(resolveJson.success, true);

    // 6. Test POST /api/session/end
    const endRes = await httpRequest(`${baseUrl}/api/session/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.strictEqual(endRes.statusCode, 200);
    const endJson = JSON.parse(endRes.body);
    assert.strictEqual(endJson.success, true);

    await stopArchServer(archDir);
  } finally {
    await stopAllArchServers();
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Wave 4: Discussion Archiver, ADR Generator & History Tests (Task 4.2 & 4.3)
// ---------------------------------------------------------------------------

test("Task 4.2 & 4.3: action: 'end' creates discussion archive in docs/architecture/discussions/ and updates doc decision history", async () => {
  const { root, cleanup } = createTempProject();
  try {
    const ctx: AppContext = { projectRoot: root };
    const archDir = join(root, "docs", "architecture");
    mkdirSync(archDir, { recursive: true });

    // 1. Create an active document with an existing decision history section
    const overviewPath = join(archDir, "overview.md");
    const initialOverview =
      "# System Architecture Overview\n\n" +
      "```mermaid\n" +
      "flowchart TD\n" +
      "    Auth --> Redis\n" +
      "```\n\n" +
      "## 1. Authentication\n" +
      "Handles user auth tokens.\n\n" +
      "## Architecture Decision History\n" +
      "- **[2026-09-01] Baseline Architecture**: Initial baseline architecture overview. ([Full Discussion](discussions/2026-09-01-baseline.md))\n";
    writeFileSync(overviewPath, initialOverview, "utf-8");

    // 2. Add comment threads for Redis node
    saveComments(root, "overview.md", [
      {
        id: "thread-redis-1",
        doc: "overview.md",
        nodeId: "Redis",
        x: 150.5,
        y: 220.0,
        status: "resolved",
        messages: [
          {
            id: "msg-1",
            author: "user",
            text: "Should we use Redis cluster with Sentinel or read replicas?",
            createdAt: 1700000000000,
          },
          {
            id: "msg-2",
            author: "agent",
            text: "Recommend Redis cluster with 3 read replicas for automatic failover and read scaling.",
            createdAt: 1700000010000,
          },
        ],
        createdAt: 1700000000000,
        updatedAt: 1700000010000,
      },
    ]);

    // 3. Call action: "end"
    const endRes = await archViewHandler(
      {
        action: "end",
        doc: "overview.md",
        text: "Title: Redis Cluster Token Caching\nSummary: Adopted Redis cluster with read replicas for auth token caching.",
      },
      ctx
    );

    assert.strictEqual(endRes.isError, undefined);
    const endText = endRes.content[0].text;
    assert.ok(endText.includes("Architecture Discussion Concluded & Archived"));
    assert.ok(endText.includes("Redis Cluster Token Caching"));
    assert.ok(endText.includes("overview.md"));
    assert.ok(endText.includes("`Redis`"));

    // 4. Verify discussions archive directory and file
    const discussionsDir = join(archDir, "discussions");
    assert.ok(existsSync(discussionsDir));

    const discussionFiles = readdirSync(discussionsDir).filter((f) =>
      f.includes("redis-cluster-token-caching")
    );
    assert.strictEqual(discussionFiles.length, 1);
    const archiveFile = discussionFiles[0];

    const archiveContent = readFileSync(join(discussionsDir, archiveFile), "utf-8");
    const { frontmatter, body } = parseDiscussionFrontmatter(archiveContent);

    // Frontmatter assertions
    assert.strictEqual(frontmatter.title, "Redis Cluster Token Caching");
    assert.strictEqual(frontmatter.doc, "overview.md");
    assert.deepStrictEqual(frontmatter.nodes, ["Redis"]);
    assert.strictEqual(
      frontmatter.summary,
      "Adopted Redis cluster with read replicas for auth token caching."
    );
    assert.match(frontmatter.date, /^\d{4}-\d{2}-\d{2}$/);

    // Body content assertions
    assert.ok(archiveContent.includes("# Redis Cluster Token Caching"));
    assert.ok(archiveContent.includes("## Executive Summary"));
    assert.ok(
      archiveContent.includes(
        "Adopted Redis cluster with read replicas for auth token caching."
      )
    );
    assert.ok(archiveContent.includes("## Key Decisions & Trade-offs"));
    assert.ok(archiveContent.includes("## Discussion Transcript"));
    assert.ok(archiveContent.includes("### Thread 1: Node `Redis`"));
    assert.ok(
      archiveContent.includes(
        "Should we use Redis cluster with Sentinel or read replicas?"
      )
    );
    assert.ok(
      archiveContent.includes(
        "Recommend Redis cluster with 3 read replicas for automatic failover and read scaling."
      )
    );

    // 5. Verify overview.md decision history was updated
    const updatedOverview = readFileSync(overviewPath, "utf-8");
    assert.ok(updatedOverview.includes("## Architecture Decision History"));
    assert.ok(
      updatedOverview.includes(
        "- **[2026-09-01] Baseline Architecture**: Initial baseline architecture overview."
      ),
      "Original baseline entry must be preserved"
    );
    assert.ok(
      updatedOverview.includes(
        `Redis Cluster Token Caching**: Adopted Redis cluster with read replicas for auth token caching. ([Full Discussion](discussions/${archiveFile}))`
      ),
      "New decision entry with link to archive file must be appended"
    );

    // 6. Test second "end" without pre-existing decision history in a fresh doc
    const pipelinePath = join(archDir, "pipeline.md");
    writeFileSync(pipelinePath, "# Processing Pipeline\n\nContent here.\n", "utf-8");
    const endRes2 = await archViewHandler(
      {
        action: "end",
        doc: "pipeline.md",
        text: "Pipeline Queue Buffer. Chose SQS FIFO for ordering.",
      },
      ctx
    );
    assert.strictEqual(endRes2.isError, undefined);
    const updatedPipeline = readFileSync(pipelinePath, "utf-8");
    assert.ok(updatedPipeline.includes("## Architecture Decision History"));
    assert.ok(updatedPipeline.includes("Pipeline Queue Buffer"));
    assert.ok(updatedPipeline.includes("([Full Discussion](discussions/"));
  } finally {
    await stopAllArchServers();
    cleanup();
  }
});

test("Task 4.2 & 4.3: action: 'history' lists all discussions, filters by doc, and filters by query", async () => {
  const { root, cleanup } = createTempProject();
  try {
    const ctx: AppContext = { projectRoot: root };
    const archDir = join(root, "docs", "architecture");
    const discussionsDir = join(archDir, "discussions");
    mkdirSync(discussionsDir, { recursive: true });

    // Seed 3 discussion files
    const d1 =
      "---\n" +
      'title: "Auth Token Caching"\n' +
      "date: 2026-09-20\n" +
      "doc: overview.md\n" +
      'nodes: ["Auth", "Redis"]\n' +
      'summary: "Decided to adopt Redis for fast token lookup and validation."\n' +
      "---\n\n" +
      "# Auth Token Caching\n\n" +
      "## Executive Summary\nDecided to adopt Redis for fast token lookup and validation.\n\n" +
      "## Discussion Transcript\n### Thread 1: Node `Redis`\n- **User**: How fast is Redis?\n- **Agent**: Sub-millisecond latency.\n";
    writeFileSync(join(discussionsDir, "2026-09-20-auth-token-caching.md"), d1, "utf-8");

    const d2 =
      "---\n" +
      'title: "Kafka Event Streaming"\n' +
      "date: 2026-09-21\n" +
      "doc: pipeline.md\n" +
      'nodes: ["Ingest", "Kafka"]\n' +
      'summary: "Switched from polling to Kafka event-driven stream processing."\n' +
      "---\n\n" +
      "# Kafka Event Streaming\n\n" +
      "## Executive Summary\nSwitched from polling to Kafka event-driven stream processing.\n\n" +
      "## Discussion Transcript\n### Thread 1: Node `Kafka`\n- **User**: What partition strategy?\n";
    writeFileSync(join(discussionsDir, "2026-09-21-kafka-event-streaming.md"), d2, "utf-8");

    const d3 =
      "---\n" +
      'title: "API Rate Limiting Ingress"\n' +
      "date: 2026-09-22\n" +
      "doc: overview.md\n" +
      'nodes: ["Gateway"]\n' +
      'summary: "Configured leaky bucket rate limiter on the public API gateway."\n' +
      "---\n\n" +
      "# API Rate Limiting Ingress\n\n" +
      "## Executive Summary\nConfigured leaky bucket rate limiter on the public API gateway.\n";
    writeFileSync(join(discussionsDir, "2026-09-22-api-rate-limiting.md"), d3, "utf-8");

    // 1. List all discussions (unfiltered)
    const listRes = await archViewHandler({ action: "history" }, ctx);
    assert.strictEqual(listRes.isError, undefined);
    const listText = listRes.content[0].text;
    assert.ok(listText.includes("Architecture Discussion History (3 records)"));
    assert.ok(listText.includes("Auth Token Caching"));
    assert.ok(listText.includes("Kafka Event Streaming"));
    assert.ok(listText.includes("API Rate Limiting Ingress"));
    assert.ok(listText.includes("overview.md"));
    assert.ok(listText.includes("pipeline.md"));

    // 2. Filter by doc
    const filterDocRes = await archViewHandler({ action: "history", doc: "pipeline.md" }, ctx);
    assert.strictEqual(filterDocRes.isError, undefined);
    const filterDocText = filterDocRes.content[0].text;
    assert.ok(filterDocText.includes("Architecture Discussion History (1 record)"));
    assert.ok(filterDocText.includes("Kafka Event Streaming"));
    assert.ok(!filterDocText.includes("Auth Token Caching"));
    assert.ok(!filterDocText.includes("API Rate Limiting Ingress"));

    // 3. Filter by query (keyword in summary / content)
    const filterQueryRes = await archViewHandler({ action: "history", query: "Redis" }, ctx);
    assert.strictEqual(filterQueryRes.isError, undefined);
    const filterQueryText = filterQueryRes.content[0].text;
    assert.ok(filterQueryText.includes("Auth Token Caching"));
    assert.ok(!filterQueryText.includes("Kafka Event Streaming"));

    // 4. Filter by query matching node
    const filterNodeRes = await archViewHandler({ action: "history", query: "Gateway" }, ctx);
    assert.strictEqual(filterNodeRes.isError, undefined);
    const filterNodeText = filterNodeRes.content[0].text;
    assert.ok(filterNodeText.includes("API Rate Limiting Ingress"));
    assert.ok(!filterNodeText.includes("Kafka Event Streaming"));

    // 5. Query with no matches returns graceful message
    const noMatchRes = await archViewHandler({ action: "history", query: "nonexistent_term" }, ctx);
    assert.strictEqual(noMatchRes.isError, undefined);
    assert.ok(noMatchRes.content[0].text.includes("No architecture discussions found"));

    // 6. Non-existent discussions dir returns clean message
    const emptyCtx: AppContext = { projectRoot: join(root, "empty-proj") };
    mkdirSync(emptyCtx.projectRoot, { recursive: true });
    const emptyRes = await archViewHandler({ action: "history" }, emptyCtx);
    assert.strictEqual(emptyRes.isError, undefined);
    assert.ok(emptyRes.content[0].text.includes("No discussion archives found"));
  } finally {
    await stopAllArchServers();
    cleanup();
  }
});
