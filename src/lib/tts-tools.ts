import { execSync, spawn } from "child_process";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

import type { ToolDef, ToolResult } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WATCHER_SCRIPT = join(__dirname, "..", "tts-watcher.js");
const PID_FILE = join(process.env.HOME!, ".zed-tts-watcher.pid");

function isRunning(): boolean {
  if (!existsSync(PID_FILE)) return false;
  const pid = readFileSync(PID_FILE, "utf-8").trim();
  try {
    process.kill(parseInt(pid, 10), 0);
    return true;
  } catch {
    try {
      unlinkSync(PID_FILE);
    } catch {
      /* */
    }
    return false;
  }
}

function getPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  return parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
}

function stop(): void {
  const pid = getPid();
  if (pid !== null) {
    process.kill(pid, "SIGTERM");
  }
  try {
    execSync("pkill -f 'say '", { encoding: "utf-8" });
  } catch {
    /* */
  }
}

export const ttsTools: ToolDef[] = [
  {
    name: "voice_mode",
    description:
      "Toggle voice mode on or off. When on, agent responses are read aloud " +
      "using macOS text-to-speech and the user can reply via macOS dictation (Fn Fn). " +
      "Call with no arguments to toggle, or pass enable: true/false to set explicitly.",
    schema: {
      enable: z
        .boolean()
        .optional()
        .describe(
          "Explicitly enable (true) or disable (false) voice mode. " +
            "Omit to toggle based on current state.",
        ),
      voice: z
        .string()
        .optional()
        .describe(
          'macOS voice name (default: "system" which uses the Spoken Content ' +
            "system voice — this is the only way to get Siri neural voices like Aaron). " +
            "Other options: Zoe, Alex, Daniel, Karen, Moira, Tessa, Fiona",
        ),
      rate: z
        .number()
        .optional()
        .describe("Speech rate in words per minute (default: 210)"),
      skipSubAgents: z
        .boolean()
        .optional()
        .describe(
          "Skip reading sub-agent (spawn_agent) results aloud (default: true)",
        ),
    },
    handler: async (
      args: Record<string, unknown>,
      ctx,
    ): Promise<ToolResult> => {
      const enable = args.enable as boolean | undefined;
      const voice = args.voice as string | undefined;
      const rate = args.rate as number | undefined;
      const skipSubAgents = args.skipSubAgents as boolean | undefined;

      const running = isRunning();
      const shouldEnable = enable ?? !running;

      if (!shouldEnable) {
        if (!running) {
          return {
            content: [{ type: "text", text: "🔇 Voice mode is already off." }],
          };
        }

        try {
          stop();
          await new Promise<void>((r) => setTimeout(r, 100));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to stop voice mode: ${message}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: "🔇 Voice mode stopped." }],
        };
      }

      if (running) {
        return {
          content: [
            {
              type: "text",
              text: `🔊 Voice mode is already on (PID ${getPid()}).`,
            },
          ],
        };
      }

      const resolvedVoice = voice || process.env.SUPER_DEV_VOICE || "system";
      const resolvedRate = String(
        rate || process.env.SUPER_DEV_VOICE_RATE || 210,
      );
      const speechMode = process.env.SUPER_DEV_SPEECH_MODE || "summary";
      const chime =
        process.env.SUPER_DEV_CHIME || "/System/Library/Sounds/Blow.aiff";

      const child = spawn(
        "node",
        [
          WATCHER_SCRIPT,
          "--voice",
          resolvedVoice,
          "--rate",
          resolvedRate,
          "--speech-mode",
          speechMode,
          "--chime",
          chime,
          "--project-root",
          ctx.projectRoot,
          "--skip-subagents",
          String(
            skipSubAgents ?? process.env.SUPER_DEV_SKIP_SUBAGENTS !== "false",
          ),
        ],
        {
          detached: true,
          stdio: "ignore",
        },
      );
      child.unref();

      return {
        content: [
          {
            type: "text",
            text:
              `🔊 Voice mode enabled (voice: ${resolvedVoice}${resolvedVoice === "system" ? " — using Siri/system voice" : ""}, rate: ${resolvedRate} wpm).\n\n` +
              `I'll read my responses aloud. Reply by voice with **Fn Fn** (macOS dictation).\n\n` +
              `Say "stop voice mode" or use the /toggle-voice-mode prompt when done.`,
          },
        ],
      };
    },
  },
];
