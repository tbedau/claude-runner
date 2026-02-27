import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Briefcase,
  Play,
  CheckCircle2,
  XCircle,
  Send,
  Square,
  Terminal,
  Clock,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { api, type JobSummary, type RunRecord } from "@/lib/api";
import { useSSE } from "@/hooks/use-sse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(start: string, end?: string): string {
  if (!end) return "running...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  return `${minutes}m ${remSec}s`;
}

function getRunStatus(run: RunRecord): string {
  if (run.status === "running") return "running";
  if (run.status === "killed") return "killed";
  if (run.exitCode === 0) return "success";
  return "failed";
}

export default function Dashboard() {
  const { runs: sseRuns } = useSSE();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [adhocPrompt, setAdhocPrompt] = useState("");
  const [triggering, setTriggering] = useState<string | null>(null);
  const [sendingAdhoc, setSendingAdhoc] = useState(false);

  useEffect(() => {
    api
      .listJobs()
      .then((data) => setJobs(data.jobs))
      .catch(() => toast.error("Failed to load jobs"))
      .finally(() => setLoading(false));
  }, []);

  const runs = sseRuns.length > 0 ? sseRuns : [];
  const runningCount = runs.filter((r) => r.status === "running").length;
  const lastCompleted = runs.find((r) => r.status !== "running");
  const lastOutcome = lastCompleted ? getRunStatus(lastCompleted) : null;

  async function handleTrigger(jobName: string) {
    setTriggering(jobName);
    try {
      const result = await api.triggerJob(jobName);
      toast.success(`Started ${jobName}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setTimeout(() => setTriggering(null), 1500);
    }
  }

  async function handleAdhoc() {
    if (!adhocPrompt.trim()) return;
    setSendingAdhoc(true);
    try {
      await api.runAdhoc(adhocPrompt);
      toast.success("Ad-hoc job started");
      setAdhocPrompt("");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSendingAdhoc(false);
    }
  }

  async function handleKill(jobName: string) {
    try {
      await api.killJob(jobName);
      toast.success(`Killed ${jobName}`);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Jobs
            </CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {jobs.length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              configured in jobs/
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Running
            </CardTitle>
            <div className="relative">
              {runningCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-warning animate-pulse" />
              )}
              <Play className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {runningCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {runningCount === 0
                ? "all clear"
                : runningCount === 1
                  ? "job in progress"
                  : "jobs in progress"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Last Run
            </CardTitle>
            {lastOutcome === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : lastOutcome === "failed" ? (
              <XCircle className="h-4 w-4 text-destructive" />
            ) : (
              <Clock className="h-4 w-4 text-muted-foreground" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {lastOutcome === "success" ? (
                <span className="text-success">Passed</span>
              ) : lastOutcome === "failed" ? (
                <span className="text-destructive">Failed</span>
              ) : lastOutcome === "killed" ? (
                <span className="text-muted-foreground">Killed</span>
              ) : (
                <span className="text-muted-foreground">&mdash;</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {lastCompleted
                ? `${lastCompleted.jobName} \u00b7 ${timeAgo(lastCompleted.startedAt)}`
                : "no runs yet"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick trigger + ad-hoc */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Quick Launch
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Job trigger buttons */}
          {jobs.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {jobs.map((job) => {
                const isRunning =
                  job.isRunning ||
                  runs.some(
                    (r) =>
                      r.jobName === job.name && r.status === "running"
                  );
                const isTriggering = triggering === job.name;

                return (
                  <Button
                    key={job.name}
                    variant={isRunning ? "secondary" : "outline"}
                    size="sm"
                    disabled={isTriggering}
                    onClick={() => handleTrigger(job.name)}
                    className={`gap-1.5${!job.enabled ? " opacity-50" : ""}`}
                  >
                    {isRunning ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    {job.name}
                  </Button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No jobs configured.{" "}
              <Link to="/jobs/new" className="text-primary hover:underline">
                Create one
              </Link>
            </p>
          )}

          {/* Ad-hoc prompt */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Terminal className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={adhocPrompt}
                onChange={(e) => setAdhocPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdhoc()}
                placeholder="Run an ad-hoc prompt..."
                className="pl-9 bg-background"
              />
            </div>
            <Button
              onClick={handleAdhoc}
              disabled={!adhocPrompt.trim() || sendingAdhoc}
              size="default"
              className="gap-1.5"
            >
              <Send className="h-3.5 w-3.5" />
              Run
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent runs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Recent Runs
          </CardTitle>
          <Link to="/runs">
            <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground">
              View all
              <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground italic py-4 text-center">
              No runs yet. Trigger a job to get started.
            </p>
          ) : (
            <div className="space-y-0.5">
              {runs.slice(0, 10).map((run) => {
                const status = getRunStatus(run);
                return (
                  <Link
                    key={run.runId}
                    to={`/runs/${run.runId}`}
                    className="flex items-center gap-3 flex-wrap rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/50 group"
                  >
                    {/* Status dot */}
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        status === "success"
                          ? "bg-success"
                          : status === "failed"
                            ? "bg-destructive"
                            : status === "running"
                              ? "bg-warning animate-pulse"
                              : "bg-muted-foreground"
                      }`}
                    />

                    {/* Job name */}
                    <span className="text-sm font-medium min-w-[80px] sm:min-w-[120px]">
                      {run.jobName}
                    </span>

                    {/* Time ago */}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {timeAgo(run.startedAt)}
                    </span>

                    {/* Duration */}
                    <span className="text-xs text-muted-foreground tabular-nums ml-auto">
                      {formatDuration(run.startedAt, run.completedAt)}
                    </span>

                    {/* Attempts badge */}
                    {run.attempts && run.attempts > 1 && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {run.attempts} attempts
                      </Badge>
                    )}

                    {/* Kill button for running jobs */}
                    {status === "running" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 sm:h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleKill(run.jobName);
                        }}
                      >
                        <Square className="h-3 w-3 mr-1" />
                        Kill
                      </Button>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
