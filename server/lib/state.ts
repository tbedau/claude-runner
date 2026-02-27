import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { config, expandHome } from "./config";

export interface RunRecord {
  runId: string;
  jobName: string;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  attempts?: number;
  status?: string;
  logFile: string;
}

function stateFilePath(): string {
  return expandHome(config.state_file || "~/.claude-runner/state.json");
}

export function getRecentRuns(): RunRecord[] {
  const stateFile = stateFilePath();
  if (!existsSync(stateFile)) return [];
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return [];
  }
}

export function updateRun(
  runId: string,
  updates: Partial<RunRecord>
): RunRecord | null {
  const stateFile = stateFilePath();
  try {
    const runs: RunRecord[] = JSON.parse(readFileSync(stateFile, "utf8"));
    const run = runs.find((r) => r.runId === runId);
    if (!run) return null;
    Object.assign(run, updates);
    const tmp = stateFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(runs, null, 2));
    renameSync(tmp, stateFile);
    return run;
  } catch {
    return null;
  }
}

export function getRunById(runId: string): RunRecord | undefined {
  return getRecentRuns().find((r) => r.runId === runId);
}

export function deleteRun(runId: string): boolean {
  const stateFile = stateFilePath();
  try {
    const runs: RunRecord[] = JSON.parse(readFileSync(stateFile, "utf8"));
    const idx = runs.findIndex((r) => r.runId === runId);
    if (idx === -1) return false;

    // Optionally delete the log file too
    const logFile = runs[idx].logFile;
    if (logFile && existsSync(logFile)) {
      const { unlinkSync } = require("fs");
      try { unlinkSync(logFile); } catch {}
    }

    runs.splice(idx, 1);
    const tmp = stateFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(runs, null, 2));
    renameSync(tmp, stateFile);
    return true;
  } catch {
    return false;
  }
}

export function deleteRuns(runIds: string[]): number {
  const stateFile = stateFilePath();
  try {
    const runs: RunRecord[] = JSON.parse(readFileSync(stateFile, "utf8"));
    const idSet = new Set(runIds);
    const toKeep: RunRecord[] = [];
    let deleted = 0;

    for (const run of runs) {
      if (!idSet.has(run.runId) || run.status === "running") {
        toKeep.push(run);
        continue;
      }
      if (run.logFile && existsSync(run.logFile)) {
        try { const { unlinkSync } = require("fs"); unlinkSync(run.logFile); } catch {}
      }
      deleted++;
    }

    const tmp = stateFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(toKeep, null, 2));
    renameSync(tmp, stateFile);
    return deleted;
  } catch {
    return 0;
  }
}

export function clearRuns(filter?: { status?: string }): number {
  const stateFile = stateFilePath();
  try {
    const runs: RunRecord[] = JSON.parse(readFileSync(stateFile, "utf8"));
    const toKeep: RunRecord[] = [];
    let deleted = 0;

    for (const run of runs) {
      const runStatus = run.status || (run.exitCode === 0 ? "success" : "failed");
      if (filter?.status && runStatus !== filter.status) {
        toKeep.push(run);
        continue;
      }
      // Don't delete currently running jobs
      if (run.status === "running") {
        toKeep.push(run);
        continue;
      }
      // Delete log file
      if (run.logFile && existsSync(run.logFile)) {
        try { const { unlinkSync } = require("fs"); unlinkSync(run.logFile); } catch {}
      }
      deleted++;
    }

    const tmp = stateFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(toKeep, null, 2));
    renameSync(tmp, stateFile);
    return deleted;
  } catch {
    return 0;
  }
}
