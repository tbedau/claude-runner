import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getRecentRuns, getRunById, deleteRun, deleteRuns, clearRuns } from "../lib/state";
import { spawnJob, killJob, jobExists } from "../lib/runner";
import { getLogContent } from "../lib/logs";

const app = new Hono();

// GET /api/runs — recent runs (paginated)
app.get("/", (c) => {
  const limit = parseInt(c.req.query("limit") || "30", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const status = c.req.query("status");

  let runs = getRecentRuns().reverse();
  if (status) {
    runs = runs.filter((r) => {
      if (status === "success") return !r.status && r.exitCode === 0;
      if (status === "failed")
        return !r.status && r.exitCode !== undefined && r.exitCode !== 0;
      return r.status === status;
    });
  }

  const total = runs.length;
  runs = runs.slice(offset, offset + limit);
  return c.json({ runs, total });
});

// POST /api/runs/trigger/:jobName — trigger a named job
app.post("/trigger/:jobName", (c) => {
  const jobName = c.req.param("jobName");
  if (!jobExists(jobName)) {
    return c.json({ error: `Job not found: ${jobName}` }, 404);
  }
  const runId = spawnJob(jobName, false);
  return c.json({ runId, jobName, status: "started" });
});

// POST /api/runs/adhoc — run an ad-hoc prompt
const adhocSchema = z.object({
  prompt: z.string().min(1, "Missing 'prompt' field"),
});

app.post("/adhoc", zValidator("json", adhocSchema), (c) => {
  const { prompt } = c.req.valid("json");
  const runId = spawnJob(prompt, true);
  return c.json({ runId, status: "started" });
});

// POST /api/runs/kill/:jobName — kill a running job
app.post("/kill/:jobName", (c) => {
  const jobName = c.req.param("jobName");
  const result = killJob(jobName);
  if (result.killed) {
    return c.json({ jobName, status: "killed" });
  }
  return c.json({ error: result.error }, 404);
});

// DELETE /api/runs/:runId — delete a single run and its log
app.delete("/:runId", (c) => {
  const runId = c.req.param("runId");
  const run = getRunById(runId);
  if (!run) {
    return c.json({ error: `Run not found: ${runId}` }, 404);
  }
  if (run.status === "running") {
    return c.json({ error: "Cannot delete a running job. Kill it first." }, 400);
  }
  const deleted = deleteRun(runId);
  if (deleted) {
    return c.json({ runId, status: "deleted" });
  }
  return c.json({ error: "Failed to delete run" }, 500);
});

// POST /api/runs/delete-batch — delete multiple runs by ID
const batchDeleteSchema = z.object({
  runIds: z.array(z.string()).min(1, "At least one runId required"),
});

app.post("/delete-batch", zValidator("json", batchDeleteSchema), (c) => {
  const { runIds } = c.req.valid("json");
  const count = deleteRuns(runIds);
  return c.json({ deleted: count });
});

// DELETE /api/runs — clear all completed runs (optionally filtered by status)
app.delete("/", (c) => {
  const status = c.req.query("status"); // e.g. "failed", "killed", "success"
  const count = clearRuns(status ? { status } : undefined);
  return c.json({ deleted: count });
});

// GET /api/runs/log/:runId — get full log content
app.get("/log/:runId", (c) => {
  const runId = c.req.param("runId");
  const run = getRunById(runId);
  if (!run) {
    return c.json({ error: `Run not found: ${runId}` }, 404);
  }
  const content = getLogContent(run.logFile);
  return c.json({
    runId,
    jobName: run.jobName,
    status: run.status || (run.exitCode === 0 ? "success" : "failed"),
    content: content || "",
  });
});

export default app;
