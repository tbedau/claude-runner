import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Play,
  Pause,
  Pencil,
  Trash2,
  Plus,
  Clock,
  FolderOpen,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { api, type JobSummary } from "@/lib/api";
import { useSSE } from "@/hooks/use-sse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const pad = (s: string) => s.padStart(2, "0");

  if (dom === "*" && mon === "*" && dow === "*") {
    return `Daily at ${pad(hour)}:${pad(min)}`;
  }
  if (dom === "*" && mon === "*" && dow !== "*") {
    const dayNames = dow
      .split(",")
      .map((d) => days[parseInt(d, 10)] || d)
      .join(", ");
    return `${dayNames} at ${pad(hour)}:${pad(min)}`;
  }
  if (min.includes("/")) {
    return `Every ${min.split("/")[1]} min`;
  }
  if (hour.includes("/")) {
    return `Every ${hour.split("/")[1]} hours`;
  }
  return cron;
}

export default function Jobs() {
  const navigate = useNavigate();
  const { runs } = useSSE();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    loadJobs();
  }, []);

  async function loadJobs() {
    try {
      const data = await api.listJobs();
      setJobs(data.jobs);
    } catch {
      toast.error("Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }

  async function handleTrigger(jobName: string) {
    setTriggering(jobName);
    try {
      await api.triggerJob(jobName);
      toast.success(`Started ${jobName}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setTimeout(() => setTriggering(null), 1500);
    }
  }

  async function handleToggle(jobName: string) {
    setToggling(jobName);
    try {
      const result = await api.toggleJob(jobName);
      setJobs((prev) =>
        prev.map((j) =>
          j.name === jobName ? { ...j, enabled: result.enabled } : j
        )
      );
      toast.success(result.enabled ? `Resumed ${jobName}` : `Paused ${jobName}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setToggling(null);
    }
  }

  async function handleDelete(jobName: string) {
    try {
      await api.deleteJob(jobName);
      toast.success(`Deleted ${jobName}`);
      setJobs((prev) => prev.filter((j) => j.name !== jobName));
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Jobs</h1>
          <p className="text-sm text-muted-foreground">
            {jobs.length} job{jobs.length !== 1 ? "s" : ""} configured
          </p>
        </div>
        <Link to="/jobs/new">
          <Button size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Job
          </Button>
        </Link>
      </div>

      {/* Job cards */}
      {jobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">
              No jobs configured yet.
            </p>
            <Link to="/jobs/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Create your first job
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => {
            const isRunning =
              job.isRunning ||
              runs.some(
                (r) => r.jobName === job.name && r.status === "running"
              );

            return (
              <Card
                key={job.name}
                className={`group relative overflow-hidden transition-colors hover:border-muted-foreground/25${!job.enabled ? " opacity-60" : ""}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        {job.name}
                        {!job.enabled && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                            Paused
                          </Badge>
                        )}
                        {isRunning && (
                          <span className="h-2 w-2 rounded-full bg-warning animate-pulse" />
                        )}
                      </CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Meta info */}
                  <div className="space-y-1.5">
                    {job.schedule && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span>{cronToHuman(job.schedule)}</span>
                      </div>
                    )}
                    {job.workdir && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <FolderOpen className="h-3 w-3 shrink-0" />
                        <span className="truncate font-mono text-[11px]">
                          {job.workdir}
                        </span>
                      </div>
                    )}
                    {job.lastRun && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <RotateCcw className="h-3 w-3 shrink-0" />
                        <span>
                          Last:{" "}
                          <span
                            className={
                              job.lastRun.status === "success"
                                ? "text-success"
                                : job.lastRun.status === "failed"
                                  ? "text-destructive"
                                  : ""
                            }
                          >
                            {job.lastRun.status}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={triggering === job.name}
                      onClick={() => handleTrigger(job.name)}
                      className="gap-1 flex-1 h-9 sm:h-8"
                    >
                      <Play className="h-3 w-3" />
                      {isRunning ? "Running" : "Run"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground"
                      disabled={toggling === job.name}
                      onClick={() => handleToggle(job.name)}
                      title={job.enabled ? "Pause schedule" : "Resume schedule"}
                    >
                      {job.enabled ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground"
                      onClick={() => navigate(`/jobs/${job.name}`)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {job.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes the YAML file and schedule. This
                            action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(job.name)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
