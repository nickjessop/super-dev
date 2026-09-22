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
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  STARTER_OVERVIEW_TEMPLATE,
} from "../src/lib/arch-tools.js";
import type { AppContext } from "../src/types.js";

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

function httpGet(url: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res: http.IncomingMessage) => {
      let data = "";
      res.on("data", (chunk: Buffer | string) => (data += chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: data,
        });
      });
    }).on("error", reject);
  });
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

test("Task 4.1 & 4.3: MCP server registers arch_view and respects SUPER_DEV_DISABLE=arch", async () => {
  const { spawn } = await import("node:child_process");

  async function queryTools(disableEnv?: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, SUPER_DEV_PROJECT_ROOT: process.cwd() };
      if (disableEnv !== undefined) {
        env.SUPER_DEV_DISABLE = disableEnv;
      } else {
        delete env.SUPER_DEV_DISABLE;
      }

      const cp = spawn("npx", ["tsx", "src/index.ts"], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      cp.stdout.on("data", (d: Buffer | string) => {
        stdout += d.toString();
        const lines = stdout.split("\n");
        for (const line of lines) {
          if (line.includes('"id":2')) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.result?.tools) {
                const names = parsed.result.tools.map((t: { name: string }) => t.name);
                cp.kill();
                resolve(names);
                return;
              }
            } catch {}
          }
        }
      });

      cp.on("error", reject);

      const initMsg = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      });
      cp.stdin.write(initMsg + "\n");

      setTimeout(() => {
        const listMsg = JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        });
        cp.stdin.write(listMsg + "\n");
      }, 300);

      setTimeout(() => {
        cp.kill();
        reject(new Error("Timeout waiting for tools/list response"));
      }, 5000);
    });
  }

  // When arch is not disabled, arch_view should be present
  const defaultTools = await queryTools();
  assert.ok(defaultTools.includes("arch_view"), "arch_view must be registered in MCP tools");

  // When SUPER_DEV_DISABLE=arch is set, arch_view should be absent
  const disabledTools = await queryTools("arch");
  assert.strictEqual(
    disabledTools.includes("arch_view"),
    false,
    "arch_view must be disabled when SUPER_DEV_DISABLE=arch"
  );
});
