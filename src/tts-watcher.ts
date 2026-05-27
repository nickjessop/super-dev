#!/usr/bin/env node
// TTS Watcher — background process that watches Zed's threads.db for new agent
// messages and reads them aloud using macOS `say`.
//
// Usage: node tts-watcher.js [--voice <name>] [--rate <wpm>]
//
// Designed to be spawned (detached) by the tts_start MCP tool and killed by tts_stop.

import { execSync, spawn } from "child_process";
import { existsSync, statSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const HOME = process.env.HOME!;
const THREADS_DB = join(
  HOME,
  "Library/Application Support/Zed/threads/threads.db",
);
const PID_FILE = join(HOME, ".zed-tts-watcher.pid");

const args = process.argv.slice(2);
function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const VOICE = getArg("voice", "system");
const RATE = getArg("rate", "210");
const SPEECH_MODE = getArg("speech-mode", "summary");
const CHIME_SOUND = getArg("chime", "/System/Library/Sounds/Blow.aiff");
const POLL_MS = parseInt(getArg("poll", "1500"), 10);
const SKIP_SUBAGENTS = getArg("skip-subagents", "true") === "true";

writeFileSync(PID_FILE, String(process.pid));
process.on("exit", () => {
  try {
    unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
});
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

let lastDbMtime = 0;
let lastThreadId: string | null = null;
let lastMessageCount = 0;
let lastSpokenText = "";
let speakingProcess: ReturnType<typeof spawn> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 1500;

function log(msg: string): void {
  process.stderr.write(`[tts-watcher] ${msg}\n`);
}

interface ThreadRow {
  id: string;
  summary: string;
  updated_at: string;
}

function getLatestThread(): ThreadRow | null {
  try {
    const query = `SELECT id, summary, updated_at FROM threads ORDER BY updated_at DESC LIMIT 1`;
    const result = execSync(
      `sqlite3 -json -readonly "${THREADS_DB}" "${query}"`,
      { encoding: "utf-8", timeout: 5000 },
    );
    const rows = JSON.parse(result.trim()) as ThreadRow[];
    return rows[0] || null;
  } catch {
    return null;
  }
}

interface ContentPart {
  Text?: string;
  ToolUse?: unknown;
  ToolResult?: unknown;
  Thinking?: unknown;
}

interface ThreadMessage {
  User?: { content: (string | ContentPart)[] };
  Agent?: { content: (string | ContentPart)[] };
}

interface ThreadData {
  messages: ThreadMessage[];
}

function readThreadData(threadId: string): ThreadData | null {
  const tmpZst = `/tmp/zed_tts_${threadId}.zst`;
  const tmpJson = `/tmp/zed_tts_${threadId}.json`;

  try {
    execSync(
      `sqlite3 -readonly "${THREADS_DB}" "SELECT writefile('${tmpZst}', data) FROM threads WHERE id = '${threadId}'"`,
      { encoding: "utf-8", timeout: 5000 },
    );
    execSync(`zstd -d "${tmpZst}" -o "${tmpJson}" --force -q`, {
      encoding: "utf-8",
      timeout: 5000,
    });
    const content = execSync(`cat "${tmpJson}"`, {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(content) as ThreadData;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Failed to read thread: ${message}`);
    return null;
  } finally {
    try {
      execSync(`rm -f "${tmpZst}" "${tmpJson}"`, { encoding: "utf-8" });
    } catch {
      /* */
    }
  }
}

function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "... code block ...")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/https?:\/\/\S+/g, "... link ...")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/\|[^\n]+\|/g, "")
    .replace(/^[-|:\s]+$/gm, "")
    .trim();
}

const speechQueue: string[] = [];

function speak(text: string, { interrupt = false } = {}): void {
  const cleaned = cleanForSpeech(text);
  if (!cleaned) return;

  const toSpeak =
    cleaned.length > 3000
      ? cleaned.slice(0, 3000) + "... message truncated."
      : cleaned;

  if (interrupt) {
    speechQueue.length = 0;
    if (speakingProcess) {
      try {
        speakingProcess.kill();
      } catch {
        /* */
      }
      speakingProcess = null;
    }
  }

  if (speakingProcess) {
    speechQueue.push(toSpeak);
    log(`Queued ${toSpeak.length} chars (queue: ${speechQueue.length})`);
    return;
  }

  speakNext(toSpeak);
}

function speakNext(toSpeak: string): void {
  log(`Speaking ${toSpeak.length} chars...`);

  const sayArgs =
    VOICE === "system"
      ? ["-r", RATE, toSpeak]
      : ["-v", VOICE, "-r", RATE, toSpeak];

  speakingProcess = spawn("say", sayArgs, {
    stdio: "ignore",
  });

  speakingProcess.on("exit", () => {
    speakingProcess = null;
    if (speechQueue.length > 0) {
      const next = speechQueue.shift()!;
      speakNext(next);
    }
  });
}

function getAgentTurnText(data: ThreadData): string {
  const messages = data.messages || [];

  const allParts: (string | ContentPart)[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].User) break;
    if (messages[i].Agent) {
      const content = messages[i].Agent!.content || [];
      allParts.unshift(...content);
    }
  }

  if (allParts.length === 0) return "";

  // Check for sub-agent activity
  if (SKIP_SUBAGENTS) {
    let toolUseCount = 0;
    let toolResultCount = 0;
    let hasSpawnAgent = false;

    for (const part of allParts) {
      if (typeof part !== "string") {
        if (part.ToolUse) {
          toolUseCount++;
          const str = JSON.stringify(part.ToolUse);
          if (str.includes("spawn_agent") || str.includes("delegate")) {
            hasSpawnAgent = true;
          }
        }
        if (part.ToolResult) {
          toolResultCount++;
        }
      }
    }

    // If sub-agents were used, suppress all speech until the turn is fully
    // done — i.e. all tool calls resolved AND the turn ends with plain text
    // (no trailing ToolUse/ToolResult meaning the agent is still working).
    if (hasSpawnAgent) {
      if (toolUseCount > toolResultCount) {
        return ""; // tools still pending
      }
      // All tools resolved — but is the agent still writing orchestration
      // text before spawning the next sub-agent?  Only speak if the last
      // content part is plain text (the final summary), not a tool part.
      const lastPart = allParts[allParts.length - 1];
      const endsWithText =
        typeof lastPart === "string" ||
        (typeof lastPart === "object" && "Text" in lastPart);
      if (!endsWithText) {
        return ""; // turn still mid-tool-interaction
      }
    }
  }

  let startIdx = 0;
  if (SPEECH_MODE === "summary") {
    for (let i = allParts.length - 1; i >= 0; i--) {
      const part = allParts[i];
      if (typeof part !== "string" && (part.ToolUse || part.ToolResult)) {
        startIdx = i + 1;
        break;
      }
    }
  }

  const textParts: string[] = [];
  for (let i = startIdx; i < allParts.length; i++) {
    const part = allParts[i];
    if (typeof part === "string") {
      textParts.push(part);
    } else if (part.Text) {
      textParts.push(part.Text);
    }
  }

  return textParts.join("\n").trim();
}

function playChime(): void {
  if (CHIME_SOUND && existsSync(CHIME_SOUND)) {
    spawn("afplay", [CHIME_SOUND], { stdio: "ignore" }).unref();
  }
}

function speakNewMessages(): void {
  const data = readThreadData(lastThreadId!);
  if (!data) return;

  const messages = data.messages || [];
  lastMessageCount = messages.length;

  const turnText = getAgentTurnText(data);

  // If user sent a new message (no agent text yet), interrupt any ongoing speech
  if (!turnText && lastSpokenText) {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.User) {
      // User sent a new message — interrupt speech
      if (speakingProcess) {
        try {
          speakingProcess.kill();
        } catch {
          /* */
        }
        speakingProcess = null;
      }
      speechQueue.length = 0;
      lastSpokenText = "";
      log("User message detected — interrupted speech");
      return;
    }
  }

  if (!turnText || turnText === lastSpokenText) return;

  let toSpeak = turnText;
  let interrupt = false;
  if (lastSpokenText && turnText.startsWith(lastSpokenText)) {
    toSpeak = turnText.slice(lastSpokenText.length).trim();
    if (!toSpeak) return;
    log(`Speaking delta (${toSpeak.length} new chars)`);
  } else if (lastSpokenText) {
    interrupt = true;
    playChime();
  } else {
    playChime();
  }

  lastSpokenText = turnText;
  speak(toSpeak, { interrupt });
}

function poll(): void {
  if (!existsSync(THREADS_DB)) return;

  let mtime: number;
  try {
    mtime = statSync(THREADS_DB).mtimeMs;
  } catch {
    return;
  }

  if (mtime === lastDbMtime) return;
  lastDbMtime = mtime;

  const latest = getLatestThread();
  if (!latest) return;

  if (latest.id !== lastThreadId) {
    lastThreadId = latest.id;
    const data = readThreadData(latest.id);
    if (data) {
      lastMessageCount = (data.messages || []).length;
    }
    log(`Now watching thread: "${latest.summary}"`);
    return;
  }

  // Check for user-message interrupt BEFORE the debounce.
  // If speech is playing and the user just sent a message, we need to
  // kill the audio immediately — not 1500ms later when the agent has
  // already started responding (which would mask the User message).
  if (speakingProcess || speechQueue.length > 0) {
    const data = readThreadData(latest.id);
    if (data) {
      const messages = data.messages || [];
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.User) {
        if (speakingProcess) {
          try {
            speakingProcess.kill();
          } catch {
            /* */
          }
          speakingProcess = null;
        }
        speechQueue.length = 0;
        lastSpokenText = "";
        lastMessageCount = messages.length;
        log("User message detected — interrupted speech");
        return;
      }
    }
  }

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    speakNewMessages();
  }, DEBOUNCE_MS);
}

// --- Start ---
log(
  `Started (PID ${process.pid}, voice: ${VOICE}, rate: ${RATE}, mode: ${SPEECH_MODE}, poll: ${POLL_MS}ms)`,
);

const latest = getLatestThread();
if (latest) {
  lastThreadId = latest.id;
  const data = readThreadData(latest.id);
  if (data) {
    lastMessageCount = (data.messages || []).length;
    lastSpokenText = getAgentTurnText(data);
  }
  log(
    `Watching thread: "${latest.summary}" (${lastMessageCount} existing messages)`,
  );
}

setInterval(poll, POLL_MS);
