import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { SCRIPT_DIR, expandHome } from "./config";

export interface JobDefinition {
  name: string;
  prompt: string;
  schedule?: string;
  retries?: number;
  timeout?: number;
  notify?: boolean;
  workdir?: string;
  enabled?: boolean;
  env?: Record<string, string>;
}

const JOBS_DIR = join(SCRIPT_DIR, "jobs");
const JOBS_LOCAL_DIR = join(SCRIPT_DIR, "jobs.local");
const JOB_NAME_RE = /^[a-z0-9-]+$/;

export function validateJobName(name: string): boolean {
  return JOB_NAME_RE.test(name);
}

/** Resolve job file path: jobs.local/ takes precedence over jobs/ */
function resolveJobFile(name: string): string | null {
  const localFile = join(JOBS_LOCAL_DIR, `${name}.yaml`);
  if (existsSync(localFile)) return localFile;
  const jobFile = join(JOBS_DIR, `${name}.yaml`);
  if (existsSync(jobFile)) return jobFile;
  return null;
}

export function listJobs(): string[] {
  const names = new Set<string>();
  for (const dir of [JOBS_DIR, JOBS_LOCAL_DIR]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".yaml")) names.add(f.replace(/\.yaml$/, ""));
    }
  }
  return [...names];
}

export function getJobDefinition(name: string): JobDefinition | null {
  const jobFile = resolveJobFile(name);
  if (!jobFile) return null;
  try {
    const content = loadYaml(readFileSync(jobFile, "utf8")) as JobDefinition;
    return content;
  } catch {
    return null;
  }
}

export function getJobYaml(name: string): string | null {
  const jobFile = resolveJobFile(name);
  if (!jobFile) return null;
  try {
    return readFileSync(jobFile, "utf8");
  } catch {
    return null;
  }
}

export function createJob(
  name: string,
  yaml: string
): { ok: boolean; error?: string } {
  if (!validateJobName(name)) {
    return { ok: false, error: "Job name must match [a-z0-9-]+" };
  }
  if (resolveJobFile(name)) {
    return { ok: false, error: `Job already exists: ${name}` };
  }
  const jobFile = join(JOBS_DIR, `${name}.yaml`);

  // Validate YAML
  try {
    loadYaml(yaml);
  } catch (e: any) {
    return { ok: false, error: `Invalid YAML: ${e.message}` };
  }

  writeFileSync(jobFile, yaml, "utf8");
  syncSchedule();
  return { ok: true };
}

export function updateJob(
  name: string,
  yaml: string
): { ok: boolean; error?: string } {
  if (!validateJobName(name)) {
    return { ok: false, error: "Job name must match [a-z0-9-]+" };
  }
  const jobFile = resolveJobFile(name);
  if (!jobFile) {
    return { ok: false, error: `Job not found: ${name}` };
  }

  // Validate YAML
  try {
    loadYaml(yaml);
  } catch (e: any) {
    return { ok: false, error: `Invalid YAML: ${e.message}` };
  }

  writeFileSync(jobFile, yaml, "utf8");
  syncSchedule();
  return { ok: true };
}

export function deleteJob(
  name: string
): { ok: boolean; error?: string } {
  if (!validateJobName(name)) {
    return { ok: false, error: "Invalid job name" };
  }
  if (
    name.includes("/") ||
    name.includes("..") ||
    name.includes("\\")
  ) {
    return { ok: false, error: "Invalid job name" };
  }

  const jobFile = resolveJobFile(name);
  if (!jobFile) {
    return { ok: false, error: `Job not found: ${name}` };
  }

  const lockDir = expandHome("~/.claude-runner/locks");
  const lockFile = join(lockDir, `${name}.lock`);
  if (existsSync(lockFile)) {
    return {
      ok: false,
      error: `Job '${name}' is currently running. Kill it first.`,
    };
  }

  try {
    unlinkSync(jobFile);
  } catch (e: any) {
    return { ok: false, error: `Failed to delete: ${e.message}` };
  }

  syncSchedule();
  return { ok: true };
}

export function toggleJob(
  name: string
): { ok: boolean; enabled?: boolean; error?: string } {
  if (!validateJobName(name)) {
    return { ok: false, error: "Invalid job name" };
  }
  const jobFile = resolveJobFile(name);
  if (!jobFile) {
    return { ok: false, error: `Job not found: ${name}` };
  }

  try {
    const raw = readFileSync(jobFile, "utf8");
    const parsed = loadYaml(raw) as Record<string, any>;
    const wasEnabled = parsed.enabled !== false;

    if (wasEnabled) {
      parsed.enabled = false;
    } else {
      delete parsed.enabled;
    }

    writeFileSync(jobFile, dumpYaml(parsed, { lineWidth: -1 }), "utf8");
    syncSchedule();
    return { ok: true, enabled: !wasEnabled };
  } catch (e: any) {
    return { ok: false, error: `Toggle failed: ${e.message}` };
  }
}

export function syncSchedule(): void {
  try {
    execSync(`bash "${join(SCRIPT_DIR, "setup.sh")}" --no-wake`, {
      cwd: SCRIPT_DIR,
      timeout: 30000,
      stdio: "pipe",
    });
  } catch (e: any) {
    console.error("Warning: setup.sh failed:", e.message);
  }
}

export function getJobInfo(name: string) {
  const def = getJobDefinition(name);
  if (!def) return null;
  const lockDir = expandHome("~/.claude-runner/locks");
  const isRunning = existsSync(join(lockDir, `${name}.lock`));
  return {
    name,
    schedule: def.schedule || null,
    workdir: def.workdir || null,
    retries: def.retries || 0,
    timeout: def.timeout || null,
    notify: def.notify !== false,
    enabled: def.enabled !== false,
    isRunning,
  };
}
