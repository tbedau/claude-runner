import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  Square,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { api, type RunRecord } from "@/lib/api";
import { useSSE } from "@/hooks/use-sse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(start: string, end?: string): string {
  const endTime = end ? new Date(end).getTime() : Date.now();
  const ms = endTime - new Date(start).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remSec}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function highlightLog(line: string): React.ReactNode {
  // Timestamp highlighting
  const timestampMatch = line.match(
    /^(\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\])/
  );
  // Level highlighting
  const levelMatch = line.match(/\[(INFO|WARN|ERROR|DEBUG)\]/);

  if (!timestampMatch && !levelMatch) {
    return <span>{line}</span>;
  }

  let result = line;
  const parts: React.ReactNode[] = [];

  if (timestampMatch) {
    const idx = result.indexOf(timestampMatch[1]);
    if (idx > 0) parts.push(result.slice(0, idx));
    parts.push(
      <span key="ts" className="text-muted-foreground">
        {timestampMatch[1]}
      </span>
    );
    result = result.slice(idx + timestampMatch[1].length);
  }

  if (levelMatch) {
    const idx = result.indexOf(levelMatch[0]);
    if (idx > 0) parts.push(result.slice(0, idx));
    const color =
      levelMatch[1] === "ERROR"
        ? "text-destructive"
        : levelMatch[1] === "WARN"
          ? "text-warning"
          : levelMatch[1] === "INFO"
            ? "text-primary"
            : "text-muted-foreground";
    parts.push(
      <span key="level" className={color}>
        {levelMatch[0]}
      </span>
    );
    result = result.slice(idx + levelMatch[0].length);
  }

  parts.push(result);
  return <>{parts}</>;
}

export default function LogViewer() {
  const { runId } = useParams<{ runId: string }>();
  const { runs: sseRuns, logs: sseLogs } = useSSE();
  const [logContent, setLogContent] = useState<string>("");
  const [run, setRun] = useState<RunRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Fetch initial log content
  useEffect(() => {
    if (!runId) return;
    api
      .getLog(runId)
      .then((data) => {
        setLogContent(data.content);
        // Build a partial RunRecord from log response
        const sseRun = sseRuns.find((r) => r.runId === runId);
        if (sseRun) {
          setRun(sseRun);
        } else {
          setRun({
            runId: data.runId,
            jobName: data.jobName,
            startedAt: "",
            logFile: "",
            status: data.status,
          });
        }
      })
      .catch(() => toast.error("Failed to load log"))
      .finally(() => setLoading(false));
  }, [runId]);

  // Update run from SSE
  const currentSseRun = sseRuns.find((r) => r.runId === runId);
  const activeRun = currentSseRun || run;
  const isRunning = activeRun?.status === "running";

  // Use SSE log data for running jobs (streams from byte 0),
  // fetched content for completed runs. Never combine both to avoid duplicates.
  const sseLog = runId ? sseLogs[runId] || "" : "";
  const fullLog = sseLog ? sseLog : logContent;

  // Auto-scroll when new content arrives
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [fullLog, autoScroll]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  }

  async function handleKill() {
    if (!activeRun) return;
    try {
      await api.killJob(activeRun.jobName);
      toast.success(`Killed ${activeRun.jobName}`);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  function handleDownload() {
    const blob = new Blob([fullLog], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${runId}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const status = activeRun
    ? activeRun.status === "running"
      ? "running"
      : activeRun.status === "killed"
        ? "killed"
        : activeRun.exitCode === 0
          ? "success"
          : "failed"
    : null;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const logLines = fullLog.split("\n");

  return (
    <div className="space-y-4">
      {/* Back link + header */}
      <div className="flex items-center gap-4">
        <Link to="/runs">
          <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold truncate">
            {activeRun?.jobName || runId}
          </h1>
          <p className="text-xs text-muted-foreground font-mono truncate">
            {runId}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={handleKill}
            >
              <Square className="h-3 w-3" />
              Kill
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleDownload}
          >
            <Download className="h-3 w-3" />
            Download
          </Button>
        </div>
      </div>

      {/* Run metadata */}
      {activeRun && (
        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 sm:gap-4 flex-wrap text-sm">
              {/* Status */}
              <div className="flex items-center gap-1.5">
                {status === "success" && (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                )}
                {status === "failed" && (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                {status === "running" && (
                  <Loader2 className="h-4 w-4 text-warning animate-spin" />
                )}
                {status === "killed" && (
                  <Square className="h-4 w-4 text-muted-foreground" />
                )}
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
                >
                  {status}
                </Badge>
              </div>

              {activeRun.startedAt && (
                <>
                  <span className="hidden sm:inline text-muted-foreground">|</span>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatTimestamp(activeRun.startedAt)}
                  </div>
                </>
              )}

              {activeRun.startedAt && (
                <>
                  <span className="hidden sm:inline text-muted-foreground">|</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDuration(activeRun.startedAt, activeRun.completedAt)}
                  </span>
                </>
              )}

              {activeRun.attempts && activeRun.attempts > 1 && (
                <>
                  <span className="hidden sm:inline text-muted-foreground">|</span>
                  <span className="text-xs text-muted-foreground">
                    {activeRun.attempts} attempts
                  </span>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Log output */}
      <Card className="overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-[calc(100dvh-320px)] overflow-auto"
        >
          <pre className="p-4 text-xs leading-5 font-mono whitespace-pre-wrap break-all">
            {fullLog ? (
              logLines.map((line, i) => (
                <div
                  key={i}
                  className="hover:bg-accent/30 px-1 -mx-1 rounded-sm"
                >
                  <span className="hidden sm:inline-block w-10 text-right text-muted-foreground/50 select-none mr-4 tabular-nums">
                    {i + 1}
                  </span>
                  {highlightLog(line)}
                </div>
              ))
            ) : (
              <span className="text-muted-foreground italic">
                {isRunning ? "Waiting for output..." : "No log output."}
              </span>
            )}
          </pre>
          {isRunning && (
            <div className="px-4 pb-3 flex items-center gap-2 text-xs text-warning">
              <Loader2 className="h-3 w-3 animate-spin" />
              Streaming live...
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
