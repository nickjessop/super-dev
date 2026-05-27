import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { z } from "zod";

import type {
  ToolDef,
  ToolResult,
  ThreadRow,
  ThreadMessage,
  ThreadData,
  ContentPart,
} from "../types.js";

const THREADS_DB = join(
  process.env.HOME!,
  "Library/Application Support/Zed/threads/threads.db",
);

function queryDb(sql: string): string {
  if (!existsSync(THREADS_DB)) {
    throw new Error(
      `Zed threads database not found at: ${THREADS_DB}\n` +
        `Make sure Zed is installed and has been used for at least one agent conversation.`,
    );
  }

  const result = execSync(
    `sqlite3 -json -readonly "${THREADS_DB}" ${JSON.stringify(sql)}`,
    {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 10000,
    },
  );
  return result.trim();
}

function readThreadData(threadId: string): ThreadData & { title?: string } {
  if (!existsSync(THREADS_DB)) {
    throw new Error(`Zed threads database not found at: ${THREADS_DB}`);
  }

  const tmpZst = `/tmp/zed_thread_${threadId}.zst`;
  const tmpJson = `/tmp/zed_thread_${threadId}.json`;

  execSync(
    `sqlite3 -readonly "${THREADS_DB}" "SELECT writefile('${tmpZst}', data) FROM threads WHERE id = '${threadId}'"`,
    { encoding: "utf-8", timeout: 10000 },
  );

  execSync(`zstd -d "${tmpZst}" -o "${tmpJson}" --force -q`, {
    encoding: "utf-8",
    timeout: 10000,
  });

  const content = execSync(`cat "${tmpJson}"`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });

  try {
    execSync(`rm -f "${tmpZst}" "${tmpJson}"`, { encoding: "utf-8" });
  } catch {
    // Ignore cleanup errors
  }

  return JSON.parse(content) as ThreadData & { title?: string };
}

function extractThreadText(threadData: ThreadData & { title?: string }): string {
  const parts: string[] = [];
  if (threadData.title) {
    parts.push(`# ${threadData.title}`);
  }

  for (const msg of threadData.messages || []) {
    const role = msg.User ? "User" : msg.Agent ? "Agent" : null;
    if (!role) continue;

    const entry = msg[role as "User" | "Agent"]!;
    const contentParts: ContentPart[] = entry.content || [];

    for (const part of contentParts) {
      if (typeof part === "string") {
        parts.push(`[${role}]: ${part}`);
      } else if ("Text" in part) {
        parts.push(`[${role}]: ${(part as { Text: string }).Text}`);
      } else if ("Thinking" in part) {
        // Skip thinking blocks for search
      } else if ("ToolUse" in part) {
        const toolUse = part.ToolUse as { name?: string };
        if (toolUse.name) {
          parts.push(`[${role} tool]: ${toolUse.name}`);
        }
      } else if ("ToolResult" in part) {
        // Skip tool results to keep text manageable
      }
    }
  }

  return parts.join("\n");
}

interface SummarizeOptions {
  maxMessages?: number;
  maxCharsPerMessage?: number;
}

function summarizeMessages(
  threadData: ThreadData & { title?: string },
  { maxMessages = 50, maxCharsPerMessage = 2000 }: SummarizeOptions = {},
): { role: string; text: string }[] {
  const messages: { role: string; text: string }[] = [];

  for (const msg of (threadData.messages || []).slice(-maxMessages)) {
    const role = msg.User ? "User" : msg.Agent ? "Agent" : null;
    if (!role) continue;

    const entry = msg[role as "User" | "Agent"]!;
    const contentParts: ContentPart[] = entry.content || [];
    const textParts: string[] = [];

    for (const part of contentParts) {
      if (typeof part === "string") {
        textParts.push(part);
      } else if ("Text" in part) {
        textParts.push((part as { Text: string }).Text);
      }
    }

    const text = textParts.join("\n").slice(0, maxCharsPerMessage);
    if (text.trim()) {
      messages.push({ role, text: text.trim() });
    }
  }

  return messages;
}

const threadListSchema = {
  limit: z
    .number()
    .optional()
    .describe("Max number of threads to return (default: 20, max: 100)"),
  project_filter: z
    .string()
    .optional()
    .describe(
      "Filter threads to those used in a specific project folder path " +
        "(substring match on folder_paths). E.g. 'kowiki' or 'super-dev-mcp'",
    ),
  search: z
    .string()
    .optional()
    .describe(
      "Search thread summaries/titles for this text (case-insensitive substring match)",
    ),
};

const threadSearchSchema = {
  query: z
    .string()
    .describe("Text to search for in conversation messages (case-insensitive)"),
  thread_count: z
    .number()
    .optional()
    .describe(
      "How many recent threads to search through (default: 10, max: 50). " +
        "More threads = slower but more thorough.",
    ),
  project_filter: z
    .string()
    .optional()
    .describe("Only search threads from this project folder (substring match)"),
};

const TOC_THRESHOLD = 20;

const threadReadSchema = {
  thread_id: z
    .string()
    .describe(
      "The UUID of the thread to read (get this from thread_list or thread_search)",
    ),
  max_messages: z
    .number()
    .optional()
    .describe(
      "Maximum number of messages to read per call (default: 20, max: 50). " +
        "Must be used with offset to read message content from large threads.",
    ),
  offset: z
    .number()
    .optional()
    .describe(
      "Start reading from this message number (0-based). " +
        "For large threads (>" +
        TOC_THRESHOLD +
        " messages), you MUST provide offset to read content — " +
        "otherwise you get a table of contents. Use the TOC to pick which range to read.",
    ),
  search: z
    .string()
    .optional()
    .describe(
      "Filter to only messages containing this text (case-insensitive). " +
        "Returns matching messages with their position in the conversation. " +
        "Best way to find specific evidence without reading the entire thread.",
    ),
  include_tool_calls: z
    .boolean()
    .optional()
    .describe(
      "Whether to include tool call details in the output (default: false). " +
        "Tool calls can be very verbose.",
    ),
  max_chars_per_message: z
    .number()
    .optional()
    .describe(
      "Truncate each message to this many characters (default: 3000). " +
        "Helps control context usage on threads with large log outputs.",
    ),
};

export const threadHistoryTools: ToolDef[] = [
  {
    name: "thread_list",
    description:
      "List recent Zed agent conversation threads. Shows thread ID, summary/title, " +
      "last updated time, and which project folder it was used in. " +
      "Use this to find past conversations you want to search or reference.",
    schema: threadListSchema,
    handler: async (args, _ctx): Promise<ToolResult> => {
      const limit = Math.min((args.limit as number) || 20, 100);

      let whereClause = "";
      const conditions: string[] = [];

      if (args.project_filter) {
        const filter = (args.project_filter as string).replace(/'/g, "''");
        conditions.push(`folder_paths LIKE '%${filter}%'`);
      }

      if (args.search) {
        const search = (args.search as string).replace(/'/g, "''");
        conditions.push(`summary LIKE '%${search}%'`);
      }

      if (conditions.length > 0) {
        whereClause = `WHERE ${conditions.join(" AND ")}`;
      }

      const sql = `SELECT id, summary, updated_at, created_at, folder_paths, length(data) as data_size FROM threads ${whereClause} ORDER BY updated_at DESC LIMIT ${limit}`;
      const raw = queryDb(sql);

      if (!raw) {
        return {
          content: [
            { type: "text" as const, text: "No threads found matching your criteria." },
          ],
        };
      }

      const rows = JSON.parse(raw) as (ThreadRow & { data_size?: number })[];

      const lines = rows.map((r, i) => {
        const updated = r.updated_at
          ? new Date(r.updated_at).toLocaleString()
          : "unknown";
        const project = r.folder_paths || "unknown";
        const sizeKb = Math.round((r.data_size || 0) / 1024);
        const estMessages = Math.round((r.data_size || 0) / 2048) || "?";
        return `${i + 1}. **${r.summary}**\n   ID: \`${r.id}\`\n   Updated: ${updated} | Project: ${project} | ~${sizeKb}KB (~${estMessages} msgs)`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `## Zed Agent Thread History (${rows.length} threads)\n\n${lines.join("\n\n")}`,
          },
        ],
      };
    },
  },

  {
    name: "thread_search",
    description:
      "Full-text search across the actual message content of recent Zed agent threads. " +
      "Unlike thread_list (which only searches titles), this decompresses and searches " +
      "the full conversation text. Useful for finding where a specific topic, file, " +
      "function, or decision was discussed across past conversations.",
    schema: threadSearchSchema,
    handler: async (args, _ctx): Promise<ToolResult> => {
      const query = (args.query as string).toLowerCase();
      const threadCount = Math.min((args.thread_count as number) || 10, 50);

      let whereClause = "";
      if (args.project_filter) {
        const filter = (args.project_filter as string).replace(/'/g, "''");
        whereClause = `WHERE folder_paths LIKE '%${filter}%'`;
      }

      const sql = `SELECT id, summary, updated_at, folder_paths FROM threads ${whereClause} ORDER BY updated_at DESC LIMIT ${threadCount}`;
      const raw = queryDb(sql);

      if (!raw) {
        return {
          content: [{ type: "text" as const, text: "No threads found to search." }],
        };
      }

      const rows = JSON.parse(raw) as ThreadRow[];
      interface SearchMatch {
        id: string;
        summary: string;
        updated_at: string;
        folder_paths?: string;
        snippets: string[];
      }
      const matches: SearchMatch[] = [];

      for (const row of rows) {
        try {
          const data = readThreadData(row.id);
          const text = extractThreadText(data);

          if (text.toLowerCase().includes(query)) {
            const lines = text.split("\n");
            const matchingLines: string[] = [];

            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(query)) {
                const start = Math.max(0, i - 1);
                const end = Math.min(lines.length - 1, i + 1);
                const snippet = lines
                  .slice(start, end + 1)
                  .map((l) => l.slice(0, 200))
                  .join("\n");
                matchingLines.push(snippet);
                if (matchingLines.length >= 5) break;
              }
            }

            matches.push({
              id: row.id,
              summary: row.summary,
              updated_at: row.updated_at,
              folder_paths: row.folder_paths,
              snippets: matchingLines,
            });
          }
        } catch (searchErr: unknown) {
          const message =
            searchErr instanceof Error ? searchErr.message : String(searchErr);
          process.stderr.write(
            `[thread-history] Failed to read thread ${row.id}: ${message}\n`,
          );
        }
      }

      if (matches.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No matches for "${args.query}" in the last ${threadCount} threads.`,
            },
          ],
        };
      }

      const output = matches.map((m) => {
        const updated = new Date(m.updated_at).toLocaleString();
        const snippetText = m.snippets
          .map((s) => `  > ${s.replace(/\n/g, "\n  > ")}`)
          .join("\n  ---\n");
        return `### ${m.summary}\nID: \`${m.id}\` | Updated: ${updated} | Project: ${m.folder_paths}\n\n${snippetText}`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `## Search Results for "${args.query}" (${matches.length} matches in ${rows.length} threads)\n\n${output.join("\n\n---\n\n")}`,
          },
        ],
      };
    },
  },

  {
    name: "thread_read",
    description:
      "Read a Zed agent thread by ID. For large threads (>" +
      TOC_THRESHOLD +
      " messages), returns a table of contents by default — " +
      "use offset or search to read actual message content. " +
      "Small threads return full content directly. " +
      "Use thread_list or thread_search first to find the thread ID.",
    schema: threadReadSchema,
    handler: async (args, _ctx): Promise<ToolResult> => {
      const threadId = args.thread_id as string;
      const includeToolCalls = (args.include_tool_calls as boolean) || false;
      const searchFilter = args.search
        ? (args.search as string).toLowerCase()
        : null;
      const maxCharsPerMessage = (args.max_chars_per_message as number) || 3000;
      const maxMessages = Math.min((args.max_messages as number) || 20, 50);
      const hasExplicitOffset = args.offset != null;
      const offset = (args.offset as number) || 0;

      if (!/^[a-f0-9-]{36}$/i.test(threadId)) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Invalid thread ID format. Expected a UUID like: 7875b92f-b4e1-4d9c-a196-a392573bbeab",
            },
          ],
          isError: true,
        };
      }

      let data: ThreadData & { title?: string };
      try {
        data = readThreadData(threadId);
      } catch (readErr: unknown) {
        const message =
          readErr instanceof Error ? readErr.message : String(readErr);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to read thread ${threadId}: ${message}`,
            },
          ],
          isError: true,
        };
      }

      const allMessages = data.messages || [];
      const totalCount = allMessages.length;
      const threadTitle = data.title || "Untitled";

      function extractMessageText(
        msg: ThreadMessage,
      ): { role: string; text: string } | null {
        const role = msg.User ? "User" : msg.Agent ? "Agent" : null;
        if (!role) return null;

        const entry = msg[role as "User" | "Agent"]!;
        const contentParts: ContentPart[] = entry.content || [];
        const textParts: string[] = [];

        for (const part of contentParts) {
          if (typeof part === "string") {
            textParts.push(part);
          } else if ("Text" in part) {
            textParts.push((part as { Text: string }).Text);
          } else if ("ToolUse" in part && includeToolCalls) {
            const toolUse = part.ToolUse as { name?: string; input?: unknown };
            textParts.push(
              `[Tool: ${toolUse.name}](${JSON.stringify(toolUse.input || {}).slice(0, 200)})`,
            );
          } else if ("ToolResult" in part && includeToolCalls) {
            const toolResult = part.ToolResult as { content?: unknown };
            const resultText =
              typeof toolResult.content === "string"
                ? toolResult.content.slice(0, 500)
                : JSON.stringify(toolResult.content || "").slice(0, 500);
            textParts.push(`[Tool Result]: ${resultText}`);
          }
        }

        const fullText = textParts.join("\n").trim();
        if (!fullText) return null;

        return { role, text: fullText };
      }

      function truncateText(text: string): string {
        if (text.length <= maxCharsPerMessage) return text;

        const lines = text.split("\n");
        const totalLines = lines.length;
        const totalChars = text.length;

        if (totalLines > 20) {
          const headLines = lines.slice(0, 5);
          const tailLines = lines.slice(-15);
          const omitted = totalLines - 20;
          return (
            headLines.join("\n") +
            `\n\n… [${omitted} lines / ${totalChars} chars omitted — use search:"keyword" to find specific content]\n\n` +
            tailLines.join("\n")
          );
        }

        return (
          text.slice(0, maxCharsPerMessage) +
          `\n\n… [truncated, ${totalChars} chars total]`
        );
      }

      function tocPreview(text: string, maxLen = 90): string {
        const firstLine = text.split("\n")[0].trim();
        if (firstLine.length <= maxLen) return firstLine;
        return firstLine.slice(0, maxLen - 1) + "…";
      }

      function sizeLabel(chars: number): string {
        if (chars < 1000) return `${chars}`;
        return `${(chars / 1024).toFixed(1)}KB`;
      }

      // MODE 1: Search
      if (searchFilter) {
        const matches: string[] = [];

        for (let i = 0; i < allMessages.length; i++) {
          const extracted = extractMessageText(allMessages[i]);
          if (!extracted) continue;

          if (extracted.text.toLowerCase().includes(searchFilter)) {
            matches.push(
              `## ${extracted.role} (message ${i + 1}/${totalCount})\n\n${truncateText(extracted.text)}`,
            );
          }
        }

        if (matches.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `# Thread: ${threadTitle} (${totalCount} messages)\n\nNo messages matched search: "${args.search}"`,
              },
            ],
          };
        }

        const capped = matches.slice(0, 30);
        const note =
          matches.length > 30
            ? `\n\n> _Showing 30 of ${matches.length} matching messages._`
            : "";

        return {
          content: [
            {
              type: "text" as const,
              text: `# Thread: ${threadTitle} (${totalCount} messages, ${matches.length} matched "${args.search}")\n\n${capped.join("\n\n---\n\n")}${note}`,
            },
          ],
        };
      }

      // MODE 2: TOC
      if (totalCount > TOC_THRESHOLD && !hasExplicitOffset) {
        const tocLines: string[] = [];

        for (let i = 0; i < allMessages.length; i++) {
          const extracted = extractMessageText(allMessages[i]);
          if (!extracted) continue;

          const size = sizeLabel(extracted.text.length);
          const warn = extracted.text.length > 3000 ? " ⚠" : "";
          const preview = tocPreview(extracted.text);
          tocLines.push(
            `| ${String(i + 1).padStart(3)} | ${extracted.role.padEnd(5)} | ${preview.padEnd(90)} | ${(size + warn).padStart(8)} |`,
          );
        }

        const header =
          `| #   | Role  | Preview${" ".repeat(83)} | Size     |\n` +
          `|-----|-------|${"-".repeat(90)}|----------|`;

        return {
          content: [
            {
              type: "text" as const,
              text:
                `# Thread: ${threadTitle} (${totalCount} messages)\n\n` +
                `${header}\n${tocLines.join("\n")}\n\n` +
                `> **To read messages:** use \`offset\` + \`max_messages\` (e.g. offset:0, max_messages:10 for the first 10).\n` +
                `> **To find specific content:** use \`search:"keyword"\`.\n` +
                `> ⚠ = large message (pasted logs, etc.) — will be auto-truncated when read.`,
            },
          ],
        };
      }

      // MODE 3: Read
      const slice = allMessages.slice(offset, offset + maxMessages);
      const messages: string[] = [];

      for (let i = 0; i < slice.length; i++) {
        const extracted = extractMessageText(slice[i]);
        if (!extracted) continue;
        messages.push(
          `## ${extracted.role} (message ${offset + i + 1}/${totalCount})\n\n${truncateText(extracted.text)}`,
        );
      }

      const showingStart = offset + 1;
      const showingEnd = Math.min(offset + maxMessages, totalCount);
      const paginationNote =
        totalCount > showingEnd
          ? `\n\n> _Showing messages ${showingStart}–${showingEnd} of ${totalCount}. Use offset:${showingEnd} to continue._`
          : totalCount > maxMessages
            ? `\n\n> _Showing messages ${showingStart}–${showingEnd} of ${totalCount}._`
            : "";

      return {
        content: [
          {
            type: "text" as const,
            text: `# Thread: ${threadTitle} (${totalCount} messages)\n\n${messages.join("\n\n---\n\n")}${paginationNote}`,
          },
        ],
      };
    },
  },
];
