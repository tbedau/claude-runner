import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getRecentRuns, type RunRecord } from "../lib/state";
import { getLogContentFromOffset } from "../lib/logs";

const app = new Hono();

// GET /api/events — SSE stream for status changes and live logs
app.get("/", (c) => {
  return streamSSE(c, async (stream) => {
    let lastRunsHash = "";
    const logOffsets: Record<string, number> = {};
    let previouslyRunning = new Set<string>();

    while (true) {
      try {
        // Check for status changes
        const runs = getRecentRuns();
        const runsHash = JSON.stringify(
          runs.map((r) => `${r.runId}:${r.status || r.exitCode}`)
        );

        const currentlyRunning = new Set(
          runs.filter((r) => r.status === "running").map((r) => r.runId)
        );

        // Flush final log content for runs that just completed
        for (const runId of previouslyRunning) {
          if (!currentlyRunning.has(runId)) {
            const run = runs.find((r) => r.runId === runId);
            if (run) {
              const offset = logOffsets[run.runId] || 0;
              const result = getLogContentFromOffset(run.logFile, offset);
              if (result && result.content) {
                logOffsets[run.runId] = result.newOffset;
                await stream.writeSSE({
                  event: "log",
                  data: JSON.stringify({
                    runId: run.runId,
                    jobName: run.jobName,
                    content: result.content,
                    offset,
                  }),
                });
              }
            }
          }
        }

        if (runsHash !== lastRunsHash) {
          lastRunsHash = runsHash;
          await stream.writeSSE({
            event: "status",
            data: JSON.stringify(runs.reverse().slice(0, 50)),
          });
        }

        // Tail logs for running jobs
        for (const runId of currentlyRunning) {
          const run = runs.find((r) => r.runId === runId)!;
          const offset = logOffsets[run.runId] || 0;
          const result = getLogContentFromOffset(run.logFile, offset);
          if (result && result.content) {
            logOffsets[run.runId] = result.newOffset;
            await stream.writeSSE({
              event: "log",
              data: JSON.stringify({
                runId: run.runId,
                jobName: run.jobName,
                content: result.content,
                offset,
              }),
            });
          }
        }

        previouslyRunning = currentlyRunning;
      } catch (e) {
        // Connection closed or error — break loop
        break;
      }

      await stream.sleep(1000);
    }
  });
});

export default app;
