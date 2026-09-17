import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

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

function parsePatternList(patterns: string | string[] | undefined): string[] {
  if (!patterns) return [];
  if (Array.isArray(patterns)) return patterns;
  const stripped = patterns.replace(/^\[|\]$/g, "").trim();
  return stripped
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
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
