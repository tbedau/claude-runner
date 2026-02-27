import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("state management", () => {
  let tmpDir: string;
  let stateFile: string;

  let getRecentRuns: typeof import("../server/lib/state").getRecentRuns;
  let updateRun: typeof import("../server/lib/state").updateRun;
  let getRunById: typeof import("../server/lib/state").getRunById;
  let deleteRun: typeof import("../server/lib/state").deleteRun;
  let deleteRuns: typeof import("../server/lib/state").deleteRuns;
  let clearRuns: typeof import("../server/lib/state").clearRuns;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "claude-runner-state-test-"));
    stateFile = join(tmpDir, "state.json");

    mock.module("../server/lib/config", () => ({
      SCRIPT_DIR: tmpDir,
      expandHome: (p: string) => p.replace(/^~/, process.env.HOME || ""),
      config: { state_file: stateFile },
      loadConfig: () => ({ state_file: stateFile }),
      PORT: 7429,
      AUTH_TOKEN: "",
    }));

    const stateMod = await import("../server/lib/state");
    getRecentRuns = stateMod.getRecentRuns;
    updateRun = stateMod.updateRun;
    getRunById = stateMod.getRunById;
    deleteRun = stateMod.deleteRun;
    deleteRuns = stateMod.deleteRuns;
    clearRuns = stateMod.clearRuns;
  });

  afterEach(() => {
    const { rmSync } = require("fs");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleRuns = [
    {
      runId: "run-1",
      jobName: "alpha",
      startedAt: "2025-01-01T00:00:00Z",
      completedAt: "2025-01-01T00:05:00Z",
      exitCode: 0,
      status: "success",
      logFile: "/tmp/fake-log-1.txt",
    },
    {
      runId: "run-2",
      jobName: "beta",
      startedAt: "2025-01-02T00:00:00Z",
      completedAt: "2025-01-02T00:10:00Z",
      exitCode: 1,
      status: "failed",
      logFile: "/tmp/fake-log-2.txt",
    },
    {
      runId: "run-3",
      jobName: "gamma",
      startedAt: "2025-01-03T00:00:00Z",
      status: "running",
      logFile: "/tmp/fake-log-3.txt",
    },
  ];

  function writeSampleState() {
    writeFileSync(stateFile, JSON.stringify(sampleRuns, null, 2));
  }

  // --- getRecentRuns ---

  test("getRecentRuns returns [] when file missing", () => {
    expect(getRecentRuns()).toEqual([]);
  });

  test("getRecentRuns parses existing records", () => {
    writeSampleState();
    const runs = getRecentRuns();
    expect(runs).toHaveLength(3);
    expect(runs[0].runId).toBe("run-1");
    expect(runs[2].status).toBe("running");
  });

  // --- updateRun ---

  test("updateRun updates a matching record", () => {
    writeSampleState();
    const updated = updateRun("run-1", { exitCode: 42, status: "failed" });
    expect(updated).not.toBeNull();
    expect(updated!.exitCode).toBe(42);
    expect(updated!.status).toBe("failed");

    // Verify persisted
    const runs = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(runs[0].exitCode).toBe(42);
  });

  test("updateRun returns null for missing ID", () => {
    writeSampleState();
    expect(updateRun("nonexistent", { status: "failed" })).toBeNull();
  });

  // --- getRunById ---

  test("getRunById finds by ID", () => {
    writeSampleState();
    const run = getRunById("run-2");
    expect(run).toBeDefined();
    expect(run!.jobName).toBe("beta");
  });

  test("getRunById returns undefined when not found", () => {
    writeSampleState();
    expect(getRunById("no-such-run")).toBeUndefined();
  });

  // --- deleteRun ---

  test("deleteRun removes record from array", () => {
    writeSampleState();
    const result = deleteRun("run-1");
    expect(result).toBe(true);
    const runs = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(runs).toHaveLength(2);
    expect(runs.find((r: any) => r.runId === "run-1")).toBeUndefined();
  });

  test("deleteRun returns false for missing ID", () => {
    writeSampleState();
    expect(deleteRun("no-such-id")).toBe(false);
  });

  // --- deleteRuns ---

  test("deleteRuns batch deletes", () => {
    writeSampleState();
    const count = deleteRuns(["run-1", "run-2"]);
    expect(count).toBe(2);
    const runs = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe("run-3");
  });

  test("deleteRuns skips running jobs", () => {
    writeSampleState();
    const count = deleteRuns(["run-1", "run-3"]);
    expect(count).toBe(1);
    const runs = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(runs).toHaveLength(2);
    expect(runs.find((r: any) => r.runId === "run-3")).toBeDefined();
  });

  // --- clearRuns ---

  test("clearRuns clears all non-running", () => {
    writeSampleState();
    const count = clearRuns();
    expect(count).toBe(2);
    const runs = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("running");
  });

  test("clearRuns filters by status", () => {
    writeSampleState();
    const count = clearRuns({ status: "failed" });
    expect(count).toBe(1);
    const runs = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(runs).toHaveLength(2);
    expect(runs.find((r: any) => r.runId === "run-2")).toBeUndefined();
  });

  test("clearRuns protects running jobs even with no filter", () => {
    writeSampleState();
    clearRuns();
    const runs = JSON.parse(readFileSync(stateFile, "utf8"));
    const running = runs.find((r: any) => r.runId === "run-3");
    expect(running).toBeDefined();
    expect(running.status).toBe("running");
  });
});
