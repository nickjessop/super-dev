import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { z } from "zod";
import type {
  AppContext,
  RuleInclusion,
  ToolDef,
  ToolResult,
} from "../types.js";
import { ok } from "../types.js";

interface RuleMeta {
  description?: string;
  inclusion: string;
  fileMatchPattern?: string;
  [key: string]: string | undefined;
}

interface RuleListing {
  name: string;
  description: string;
  inclusion: string;
  patterns: string[];
  filePath: string;
}

interface ResolvedRule extends RuleListing {
  body: string;
}

function rulesDir(projectRoot: string): string {
  return join(projectRoot, ".rules");
}

function parseRule(content: string): { meta: RuleMeta; body: string } {
  const fm = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fm) return { meta: { inclusion: "always" }, body: content };

  const meta: Record<string, string> = {};
  for (const line of fm[1].split("\n")) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) {
      let val = m[2].trim();
      val = val.replace(/^["']|["']$/g, "");
      meta[m[1]] = val;
    }
  }
  if (!meta.inclusion) meta.inclusion = "always";
  return { meta: meta as unknown as RuleMeta, body: fm[2] };
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<DOUBLESTAR>")
    .replace(/\*/g, "[^/]*")
    .replace(/<DOUBLESTAR>/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function parsePatternList(patterns: string | string[] | undefined): string[] {
  if (!patterns) return [];
  if (Array.isArray(patterns)) return patterns;
  const stripped = patterns.replace(/^\[|\]$/g, "").trim();
  return stripped
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function matchAnyPattern(
  patterns: string | string[] | undefined,
  path: string,
): boolean {
  const list = parsePatternList(patterns);
  return list.some((p) => globToRegex(p).test(path));
}

export function listAllRules(projectRoot: string): RuleListing[] {
  const dir = rulesDir(projectRoot);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f: string) => f.endsWith(".md"))
    .map((file: string) => {
      const content = readFileSync(join(dir, file), "utf-8");
      const { meta } = parseRule(content);
      return {
        name: file.replace(/\.md$/, ""),
        description: meta.description || "",
        inclusion: meta.inclusion,
        patterns: parsePatternList(meta.fileMatchPattern),
        filePath: join(dir, file),
      };
    });
}

export function resolveRules(
  projectRoot: string,
  { filePath }: { filePath?: string } = {},
): ResolvedRule[] {
  const all = listAllRules(projectRoot);

  return all
    .filter((rule) => {
      if (rule.inclusion === "always") return true;
      if (rule.inclusion === "manual") return false;
      if (rule.inclusion === "auto" || rule.inclusion === "fileMatch") {
        if (!filePath) return false;
        return matchAnyPattern(rule.patterns, filePath);
      }
      return false;
    })
    .map((rule) => {
      const content = readFileSync(rule.filePath, "utf-8");
      const { body } = parseRule(content);
      return { ...rule, body };
    });
}

export function readRule(
  projectRoot: string,
  name: string,
): { name: string; meta: RuleMeta; body: string } | null {
  const file = join(rulesDir(projectRoot), `${name}.md`);
  if (!existsSync(file)) return null;
  const content = readFileSync(file, "utf-8");
  const { meta, body } = parseRule(content);
  return { name, meta, body };
}

export const loadRulesSchema: Record<string, z.ZodType> = {
  filePath: z
    .string()
    .optional()
    .describe(
      "Path to a file you're working on (relative to project root). Returns rules matching its glob patterns plus all 'always' rules. Omit to get only 'always' rules.",
    ),
};

export async function loadRulesHandler(
  { filePath }: { filePath?: string },
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  const rules = resolveRules(projectRoot, { filePath });
  if (rules.length === 0) {
    return ok("No matching rules found in .rules/.");
  }

  const header = filePath
    ? `# Rules for ${filePath}\n\nMatched ${rules.length} rule(s):\n${rules.map((r) => `  - ${r.name}`).join("\n")}\n\n---\n\n`
    : `# Project Rules\n\nLoaded ${rules.length} rule(s).\n\n---\n\n`;

  const body = rules
    .map((r) => `## ${r.name}\n\n${r.body.trim()}`)
    .join("\n\n---\n\n");

  return ok(header + body);
}

export const rulesTools: ToolDef[] = [
  {
    name: "load_rules",
    description:
      "Load project rules from .rules/. Pass filePath to get rules whose glob patterns match (auto-discovery). Omit filePath to get only the always-included rules.",
    schema: loadRulesSchema,
    handler: loadRulesHandler as ToolDef["handler"],
  },
];
