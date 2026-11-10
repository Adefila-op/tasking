// Past comparison results, kept on the device as one JSON file.
import * as FileSystem from "expo-file-system/legacy";
import type { QuestionFormat, TaskType, Verdict } from "./compare";

export type HistoryEntry = {
  id: string;
  at: number;
  task: string;          // menu label, e.g. "1) Compare images"
  type: TaskType;
  format: QuestionFormat;
  guide: string | null;  // project name, or null when no guide was used
  question: string;
  verdict: Verdict;
};

const FILE = `${FileSystem.documentDirectory}history.json`;
const MAX = 100;

async function readAll(): Promise<HistoryEntry[]> {
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return [];
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(FILE));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function listHistory(): Promise<HistoryEntry[]> {
  return readAll();
}

export async function addHistory(entry: Omit<HistoryEntry, "id" | "at">): Promise<HistoryEntry> {
  const full: HistoryEntry = { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() };
  const all = [full, ...(await readAll())].slice(0, MAX);
  await FileSystem.writeAsStringAsync(FILE, JSON.stringify(all));
  return full;
}

export async function clearHistory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(FILE);
  if (info.exists) await FileSystem.deleteAsync(FILE, { idempotent: true });
}

export function verdictText(e: HistoryEntry): string {
  const head = e.verdict.winner === "tie" ? "Tie" : `Item ${e.verdict.winner} is better`;
  const lines = [
    `${e.task}${e.guide ? ` · ${e.guide}` : ""}`,
    e.question ? `Question: ${e.question}` : "",
    `${head} (confidence ${Math.round(e.verdict.confidence * 100)}%)`,
    e.verdict.reason,
    "",
    ...e.verdict.criteria.map((c) => `${c.guideline}: ${c.better === "tie" ? "tie" : `${c.better} better`}\n  A: ${c.A}\n  B: ${c.B}`),
  ];
  return lines.filter((l) => l !== undefined).join("\n").trim();
}
