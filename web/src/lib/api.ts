const API_BASE = "/api";

function getToken(): string {
  return localStorage.getItem("cr-token") || "";
}

export function setToken(token: string) {
  localStorage.setItem("cr-token", token);
}

export function getStoredToken(): string {
  return getToken();
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Jobs API
export interface JobSummary {
  name: string;
  schedule: string | null;
  workdir: string | null;
  enabled: boolean;
  isRunning: boolean;
  lastRun: {
    runId: string;
    status: string;
    startedAt: string;
    completedAt?: string;
  } | null;
}

export interface JobDetail {
  name: string;
  schedule: string | null;
  workdir: string | null;
  retries: number;
  timeout: number | null;
  notify: boolean;
  enabled: boolean;
  isRunning: boolean;
  yaml: string;
}

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

export const api = {
  // Jobs
  listJobs: () => request<{ jobs: JobSummary[] }>("/jobs"),
  getJob: (name: string) => request<JobDetail>(`/jobs/${name}`),
  createJob: (name: string, yaml: string) =>
    request<{ name: string; status: string }>("/jobs", {
      method: "POST",
      body: JSON.stringify({ name, yaml }),
    }),
  updateJob: (name: string, yaml: string) =>
    request<{ name: string; status: string }>(`/jobs/${name}`, {
      method: "PUT",
      body: JSON.stringify({ yaml }),
    }),
  deleteJob: (name: string) =>
    request<{ name: string; status: string }>(`/jobs/${name}`, {
      method: "DELETE",
    }),
  toggleJob: (name: string) =>
    request<{ name: string; enabled: boolean }>(`/jobs/${name}/toggle`, {
      method: "PATCH",
    }),

  // Runs
  listRuns: (params?: { limit?: number; offset?: number; status?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));
    if (params?.status) searchParams.set("status", String(params.status));
    const qs = searchParams.toString();
    return request<{ runs: RunRecord[]; total: number }>(
      `/runs${qs ? `?${qs}` : ""}`
    );
  },
  triggerJob: (jobName: string) =>
    request<{ runId: string; jobName: string; status: string }>(
      `/runs/trigger/${jobName}`,
      { method: "POST" }
    ),
  runAdhoc: (prompt: string) =>
    request<{ runId: string; status: string }>("/runs/adhoc", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  killJob: (jobName: string) =>
    request<{ jobName: string; status: string }>(
      `/runs/kill/${jobName}`,
      { method: "POST" }
    ),
  deleteRun: (runId: string) =>
    request<{ runId: string; status: string }>(`/runs/${runId}`, {
      method: "DELETE",
    }),
  deleteBatchRuns: (runIds: string[]) =>
    request<{ deleted: number }>("/runs/delete-batch", {
      method: "POST",
      body: JSON.stringify({ runIds }),
    }),
  clearRuns: (status?: string) => {
    const qs = status ? `?status=${status}` : "";
    return request<{ deleted: number }>(`/runs${qs}`, {
      method: "DELETE",
    });
  },
  getLog: (runId: string) =>
    request<{
      runId: string;
      jobName: string;
      status: string;
      content: string;
    }>(`/runs/log/${runId}`),

  // System
  health: () => request<{ ok: boolean }>("/health"),
  syncSchedule: () =>
    request<{ status: string }>("/schedule/sync", { method: "POST" }),
};
