import { existsSync, readFileSync, statSync } from "fs";
import { expandHome } from "./config";

export function getLogContent(logFile: string): string | null {
  const path = expandHome(logFile);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function getLogContentFromOffset(
  logFile: string,
  offset: number
): { content: string; newOffset: number } | null {
  const path = expandHome(logFile);
  if (!existsSync(path)) return null;
  try {
    const stats = statSync(path);
    if (stats.size <= offset) {
      return { content: "", newOffset: offset };
    }
    const fd = Bun.file(path);
    const buffer = readFileSync(path);
    const content = buffer.subarray(offset).toString("utf8");
    return { content, newOffset: stats.size };
  } catch {
    return null;
  }
}

export function getLogSize(logFile: string): number {
  const path = expandHome(logFile);
  if (!existsSync(path)) return 0;
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
