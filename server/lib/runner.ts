import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { SCRIPT_DIR, expandHome } from "./config";
import { updateRun } from "./state";

const RUNNER = join(SCRIPT_DIR, "runner.sh");

export function spawnJob(jobNameOrPrompt: string, isInline: boolean): string {
  const args = isInline
    ? ["--prompt", jobNameOrPrompt]
    : [jobNameOrPrompt];

  const { CLAUDECODE, ...cleanEnv } = process.env;

  // Ensure PATH includes homebrew + common binary locations
  // (launchd provides a minimal PATH that may lack these)
  const extraPaths = ["/opt/homebrew/bin", "/usr/local/bin", `${process.env.HOME}/.bun/bin`, `${process.env.HOME}/.local/bin`];
  const currentPath = cleanEnv.PATH || "/usr/bin:/bin";
  const fullPath = [...new Set([...extraPaths, ...currentPath.split(":")])].join(":");

  const child = spawn(RUNNER, args, {
    detached: true,
    stdio: "ignore",
    cwd: SCRIPT_DIR,
    env: { ...cleanEnv, PATH: fullPath },
  });
  child.on("error", (err) => {
    console.error(`Failed to spawn runner.sh: ${err.message}`);
  });
  child.unref();

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 15);
  const jobName = isInline ? "adhoc" : jobNameOrPrompt;
  return `${jobName}-${timestamp}`;
}

export function killJob(
  jobName: string
): { killed: boolean; error?: string } {
  const lockDir = expandHome("~/.claude-runner/locks");
  const pidFile = join(lockDir, `${jobName}.pid`);

  // Try to kill the actual process if PID file exists
  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
      process.kill(-pid, "SIGTERM");
    } catch (e: any) {
      if (e.code !== "ESRCH") {
        // ESRCH = process already gone, that's fine
        return { killed: false, error: e.message };
      }
    }

    // Clean up lock and pidfile
    try {
      const fs = require("fs");
      fs.rmSync(pidFile);
      fs.rmSync(join(lockDir, `${jobName}.lock`), { recursive: true });
    } catch {}
  }

  // Mark any "running" entries for this job as killed in state.json
  // (handles both normal kills and stale entries where the process is already gone)
  const { getRecentRuns } = require("./state");
  const runs = getRecentRuns();
  const staleRuns = runs.filter(
    (r: any) => r.jobName === jobName && r.status === "running"
  );

  if (staleRuns.length === 0) {
    return { killed: false, error: "No running process found" };
  }

  for (const run of staleRuns) {
    updateRun(run.runId, {
      status: "killed",
      completedAt: new Date().toISOString(),
      exitCode: 137,
    });
  }

  return { killed: true };
}

export function jobExists(jobName: string): boolean {
  const localFile = join(SCRIPT_DIR, "jobs.local", `${jobName}.yaml`);
  if (existsSync(localFile)) return true;
  const jobFile = join(SCRIPT_DIR, "jobs", `${jobName}.yaml`);
  return existsSync(jobFile);
}
