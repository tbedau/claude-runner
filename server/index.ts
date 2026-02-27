import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { PORT, AUTH_TOKEN, SCRIPT_DIR } from "./lib/config";
import { syncSchedule } from "./lib/jobs";
import { listJobs } from "./lib/jobs";
import jobsRoute from "./routes/jobs";
import runsRoute from "./routes/runs";
import eventsRoute from "./routes/events";
import { join } from "path";
import { existsSync } from "fs";

const app = new Hono();

// CORS for dev (Vite on :5173)
app.use("/api/*", cors());

// Auth middleware for all /api routes
app.use("/api/*", async (c, next) => {
  if (!AUTH_TOKEN || AUTH_TOKEN === "changeme") {
    return next();
  }

  // Accept token from Authorization header or query param (for SSE)
  const header = c.req.header("Authorization");
  const queryToken = c.req.query("token");

  if (header === `Bearer ${AUTH_TOKEN}` || queryToken === AUTH_TOKEN) {
    return next();
  }

  return c.json({ error: "Unauthorized" }, 401);
});

// API routes
app.route("/api/jobs", jobsRoute);
app.route("/api/runs", runsRoute);
app.route("/api/events", eventsRoute);

// Health check
app.get("/api/health", (c) => c.json({ ok: true }));

// Schedule sync
app.post("/api/schedule/sync", (c) => {
  syncSchedule();
  return c.json({ status: "synced" });
});

// Serve static frontend in production
const distPath = join(SCRIPT_DIR, "web", "dist");
if (existsSync(distPath)) {
  app.use("/*", serveStatic({ root: "./web/dist" }));
  // SPA fallback — serve index.html for non-API, non-file routes
  app.get("*", async (c) => {
    const indexPath = join(distPath, "index.html");
    if (existsSync(indexPath)) {
      return c.html(await Bun.file(indexPath).text());
    }
    return c.notFound();
  });
}

console.log(`claude-runner server listening on http://localhost:${PORT}`);
console.log(`Available jobs: ${listJobs().join(", ") || "(none)"}`);

export default {
  port: PORT,
  fetch: app.fetch,
  idleTimeout: 255, // max value — keep SSE connections alive
};
