import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  listJobs,
  getJobInfo,
  getJobYaml,
  createJob,
  updateJob,
  deleteJob,
  toggleJob,
} from "../lib/jobs";
import { getRecentRuns } from "../lib/state";

const app = new Hono();

// GET /api/jobs — list all jobs with status
app.get("/", (c) => {
  const names = listJobs();
  const runs = getRecentRuns();
  const jobs = names.map((name) => {
    const info = getJobInfo(name);
    const lastRun = [...runs].reverse().find((r) => r.jobName === name);
    return {
      name,
      schedule: info?.schedule || null,
      workdir: info?.workdir || null,
      enabled: info?.enabled !== false,
      isRunning: info?.isRunning || false,
      lastRun: lastRun
        ? {
            runId: lastRun.runId,
            status: lastRun.status || (lastRun.exitCode === 0 ? "success" : "failed"),
            startedAt: lastRun.startedAt,
            completedAt: lastRun.completedAt,
          }
        : null,
    };
  });
  return c.json({ jobs });
});

// GET /api/jobs/:name — get job with full YAML
app.get("/:name", (c) => {
  const name = c.req.param("name");
  const info = getJobInfo(name);
  if (!info) {
    return c.json({ error: `Job not found: ${name}` }, 404);
  }
  const yaml = getJobYaml(name);
  return c.json({ ...info, yaml });
});

// POST /api/jobs — create a new job
const createSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, "Job name must match [a-z0-9-]+"),
  yaml: z.string().min(1),
});

app.post("/", zValidator("json", createSchema), (c) => {
  const { name, yaml } = c.req.valid("json");
  const result = createJob(name, yaml);
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }
  return c.json({ name, status: "created" }, 201);
});

// PUT /api/jobs/:name — update a job
const updateSchema = z.object({
  yaml: z.string().min(1),
});

app.put("/:name", zValidator("json", updateSchema), (c) => {
  const name = c.req.param("name");
  const { yaml } = c.req.valid("json");
  const result = updateJob(name, yaml);
  if (!result.ok) {
    const status = result.error?.includes("not found") ? 404 : 400;
    return c.json({ error: result.error }, status);
  }
  return c.json({ name, status: "updated" });
});

// PATCH /api/jobs/:name/toggle — pause/resume a job
app.patch("/:name/toggle", (c) => {
  const name = c.req.param("name");
  const result = toggleJob(name);
  if (!result.ok) {
    const status = result.error?.includes("not found") ? 404 : 400;
    return c.json({ error: result.error }, status);
  }
  return c.json({ name, enabled: result.enabled });
});

// DELETE /api/jobs/:name — delete a job
app.delete("/:name", (c) => {
  const name = c.req.param("name");
  const result = deleteJob(name);
  if (!result.ok) {
    const status = result.error?.includes("not found") ? 404 : 400;
    return c.json({ error: result.error }, status);
  }
  return c.json({ name, status: "deleted" });
});

export default app;
