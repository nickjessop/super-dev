import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { z } from "zod";

import type { ToolDef } from "../types.js";
import { ok, err } from "../types.js";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const TODO_DIR = join(process.env.HOME!, ".super-dev", "todo-lists");

function ensureDir(): void {
  if (!existsSync(TODO_DIR)) mkdirSync(TODO_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

interface TodoTask {
  description: string;
  done: boolean;
}

interface TodoList {
  id: string;
  goal: string;
  tasks: TodoTask[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listPath(id: string): string {
  return join(TODO_DIR, `${id}.json`);
}

function loadList(id: string): TodoList | null {
  const p = listPath(id);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as TodoList;
}

function saveList(list: TodoList): void {
  ensureDir();
  writeFileSync(listPath(list.id), JSON.stringify(list, null, 2), "utf-8");
}

function formatList(list: TodoList): string {
  const lines: string[] = [];
  lines.push(`📋 TODO [id: ${list.id}]`);
  lines.push(`Goal: ${list.goal}`);
  lines.push("");
  for (const t of list.tasks) {
    lines.push(`${t.done ? "[x]" : "[ ]"} ${t.description}`);
  }
  const done = list.tasks.filter((t) => t.done).length;
  lines.push("");
  lines.push(`Progress: ${done}/${list.tasks.length}`);
  return lines.join("\n");
}

function loadAllLists(): TodoList[] {
  ensureDir();
  const files = readdirSync(TODO_DIR).filter((f: string) => f.endsWith(".json"));
  return files
    .map((f: string) => {
      try {
        return JSON.parse(readFileSync(join(TODO_DIR, f), "utf-8")) as TodoList;
      } catch {
        return null;
      }
    })
    .filter((l: TodoList | null): l is TodoList => l !== null);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function formatSummary(lists: TodoList[]): string {
  if (lists.length === 0) return "No todo lists found.";
  const lines: string[] = ["Todo Lists:"];
  for (const list of lists) {
    const done = list.tasks.filter((t) => t.done).length;
    const date = list.updatedAt.slice(0, 10);
    lines.push(
      `  ${list.id}  ${truncate(list.goal, 35).padEnd(35)}  ${done}/${list.tasks.length}  ${date}`,
    );
  }
  return lines.join("\n");
}

function isCompleted(list: TodoList): boolean {
  return list.tasks.length > 0 && list.tasks.every((t) => t.done);
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const todoTools: ToolDef[] = [
  {
    name: "todo_write",
    description:
      "Create or update a todo list to track progress on a multi-step task. " +
      "Omit id to create a new list; include id to update an existing one. " +
      "Send the complete goal and tasks array each time (full replacement). " +
      "Do not use this tool when executing a spec — specs have their own task tracking.",
    schema: {
      id: z.string().optional(),
      goal: z.string(),
      tasks: z.array(
        z.object({ description: z.string(), done: z.boolean() }),
      ),
    },
    handler: async (args) => {
      const id = args.id as string | undefined;
      const goal = args.goal as string;
      const tasks = args.tasks as TodoTask[];
      const now = new Date().toISOString();

      if (id) {
        const existing = loadList(id);
        if (!existing) return err(`Todo list not found: ${id}`);
        existing.goal = goal;
        existing.tasks = tasks;
        existing.updatedAt = now;
        saveList(existing);
        return ok(formatList(existing));
      }

      const newId = Date.now().toString();
      const list: TodoList = {
        id: newId,
        goal,
        tasks,
        createdAt: now,
        updatedAt: now,
      };
      saveList(list);
      return ok(formatList(list));
    },
  },
  {
    name: "todo_read",
    description:
      "Read a todo list by ID, or list all todo lists if no ID is provided.",
    schema: {
      id: z.string().optional(),
    },
    handler: async (args) => {
      const id = args.id as string | undefined;

      if (id) {
        const list = loadList(id);
        if (!list) return err(`Todo list not found: ${id}`);
        return ok(formatList(list));
      }

      const lists = loadAllLists();
      return ok(formatSummary(lists));
    },
  },
  {
    name: "todo_clear",
    description:
      "Clear todo lists. With id: delete one list. With all: true: delete everything. " +
      "With no arguments: delete only completed lists.",
    schema: {
      id: z.string().optional(),
      all: z.boolean().optional(),
    },
    handler: async (args) => {
      const id = args.id as string | undefined;
      const all = args.all as boolean | undefined;

      // Delete a specific list
      if (id) {
        const p = listPath(id);
        if (!existsSync(p)) return err(`Todo list not found: ${id}`);
        unlinkSync(p);
        return ok(`Deleted todo list ${id}.`);
      }

      // Delete all lists
      if (all) {
        const lists = loadAllLists();
        for (const list of lists) {
          const p = listPath(list.id);
          if (existsSync(p)) unlinkSync(p);
        }
        return ok(`Deleted ${lists.length} todo list(s).`);
      }

      // Delete only completed lists
      const lists = loadAllLists();
      const completed = lists.filter(isCompleted);
      for (const list of completed) {
        const p = listPath(list.id);
        if (existsSync(p)) unlinkSync(p);
      }
      return ok(`Deleted ${completed.length} completed todo list(s).`);
    },
  },
];
