import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Square, FileText, ChevronLeft, ChevronRight, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type RunRecord } from "@/lib/api";
import { useSSE } from "@/hooks/use-sse";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

function timeAgo(dateStr: string): string {
  const diff = Math.max(0, Date.now() - new Date(dateStr).getTime());
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
  if (minutes < 60) return `${minutes}m ${remSec}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function getRunStatus(run: RunRecord): string {
  if (run.status === "running") return "running";
  if (run.status === "killed") return "killed";
  if (run.exitCode === 0) return "success";
  return "failed";
}

const PAGE_SIZE = 20;

export default function Runs() {
  const { runs: sseRuns } = useSSE();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadRuns();
  }, [filter, page]);

  // Clear selection when filter or page changes
  useEffect(() => {
    setSelected(new Set());
  }, [filter, page]);

  async function loadRuns() {
    setLoading(true);
    try {
      const params: { limit: number; offset: number; status?: string } = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      };
      if (filter !== "all") params.status = filter;
      const data = await api.listRuns(params);
      setRuns(data.runs);
      setTotal(data.total);
    } catch {
      toast.error("Failed to load runs");
    } finally {
      setLoading(false);
    }
  }

  // Merge SSE updates for running status
  const mergedRuns = runs.map((run) => {
    const sseRun = sseRuns.find((r) => r.runId === run.runId);
    return sseRun || run;
  });

  // Selectable runs (not currently running)
  const selectableRuns = mergedRuns.filter((r) => getRunStatus(r) !== "running");
  const allSelectableSelected = selectableRuns.length > 0 && selectableRuns.every((r) => selected.has(r.runId));

  function toggleSelect(runId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelectableSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableRuns.map((r) => r.runId)));
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

  async function handleDelete(runId: string) {
    try {
      await api.deleteRun(runId);
      toast.success("Run deleted");
      setSelected((prev) => { const next = new Set(prev); next.delete(runId); return next; });
      loadRuns();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    try {
      const result = await api.deleteBatchRuns([...selected]);
      toast.success(`Deleted ${result.deleted} run${result.deleted !== 1 ? "s" : ""}`);
      setSelected(new Set());
      loadRuns();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleClearAll() {
    const statusFilter = filter !== "all" ? filter : undefined;
    try {
      const result = await api.clearRuns(statusFilter);
      toast.success(`Deleted ${result.deleted} run${result.deleted !== 1 ? "s" : ""}`);
      setSelected(new Set());
      loadRuns();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (loading && runs.length === 0) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Runs</h1>
          <p className="text-sm text-muted-foreground">
            {total} total run{total !== 1 ? "s" : ""}
          </p>
        </div>
        {total > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs text-muted-foreground"
            onClick={handleClearAll}
          >
            <Trash2 className="h-3 w-3" />
            Clear {filter !== "all" ? filter : "all"}
          </Button>
        )}
      </div>

      {/* Filter tabs */}
      <Tabs value={filter} onValueChange={(v) => { setFilter(v); setPage(0); }}>
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="running">Running</TabsTrigger>
          <TabsTrigger value="success">Succeeded</TabsTrigger>
          <TabsTrigger value="failed">Failed</TabsTrigger>
          <TabsTrigger value="killed">Killed</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Runs table */}
      <Card>
        <CardContent className="p-0">
          {mergedRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground italic py-8 text-center">
              No runs match this filter.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {/* Select all header */}
              {selectableRuns.length > 0 && (
                <div className="flex items-center gap-4 px-4 py-2 bg-muted/30">
                  <Checkbox
                    checked={allSelectableSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                  <span className="text-xs text-muted-foreground">
                    {selected.size > 0
                      ? `${selected.size} selected`
                      : "Select all"}
                  </span>
                </div>
              )}

              {mergedRuns.map((run) => {
                const status = getRunStatus(run);
                const isSelectable = status !== "running";
                const isSelected = selected.has(run.runId);

                return (
                  <div
                    key={run.runId}
                    className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-4 py-3 transition-colors hover:bg-accent/50 group"
                  >
                    {/* Top line: checkbox + status dot + job name + badge + actions */}
                    <div className="flex items-center gap-3 sm:contents">
                      {/* Checkbox */}
                      {isSelectable ? (
                        <div className="p-2 -m-2 sm:p-0 sm:m-0">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(run.runId)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Select ${run.runId}`}
                          />
                        </div>
                      ) : (
                        <div className="h-4 w-4" />
                      )}

                      {/* Status dot */}
                      <Link
                        to={`/runs/${run.runId}`}
                        className="flex items-center gap-3 flex-1 min-w-0 sm:contents"
                      >
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
                        <span className="text-sm font-medium truncate sm:w-36">
                          {run.jobName}
                        </span>

                        {/* Status badge */}
                        <Badge
                          variant={
                            status === "success"
                              ? "success"
                              : status === "failed"
                                ? "destructive"
                                : status === "running"
                                  ? "warning"
                                  : "secondary"
                          }
                          className="text-[10px] w-16 justify-center"
                        >
                          {status}
                        </Badge>
                      </Link>

                      {/* Actions (visible on mobile, hover on desktop) */}
                      <div className="flex items-center gap-1 shrink-0 sm:order-last">
                        {status === "running" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 sm:h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                            onClick={() => handleKill(run.jobName)}
                          >
                            <Square className="h-3 w-3 mr-1" />
                            Kill
                          </Button>
                        )}
                        {status !== "running" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 sm:h-6 px-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                            onClick={() => handleDelete(run.runId)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                        <Link to={`/runs/${run.runId}`} className="hidden sm:block">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" />
                        </Link>
                      </div>
                    </div>

                    {/* Bottom line: time, duration, attempts (mobile only shows below) */}
                    <Link
                      to={`/runs/${run.runId}`}
                      className="flex items-center gap-3 sm:contents pl-9 sm:pl-0"
                    >
                      {/* Started */}
                      <span className="text-xs text-muted-foreground tabular-nums sm:w-20">
                        {timeAgo(run.startedAt)}
                      </span>

                      {/* Duration */}
                      <span className="text-xs text-muted-foreground tabular-nums sm:w-20">
                        {formatDuration(run.startedAt, run.completedAt)}
                      </span>

                      {/* Attempts */}
                      <span className="text-xs text-muted-foreground tabular-nums sm:w-12">
                        {run.attempts && run.attempts > 1
                          ? `${run.attempts}x`
                          : ""}
                      </span>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 sm:h-8 sm:w-8"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 sm:h-8 sm:w-8"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Batch action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center gap-3 bg-card border border-border rounded-lg shadow-lg px-4 py-2.5">
            <span className="text-sm font-medium tabular-nums">
              {selected.size} selected
            </span>
            <div className="h-4 w-px bg-border" />
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={handleDeleteSelected}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setSelected(new Set())}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
