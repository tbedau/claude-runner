import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
} from "react";
import type { RunRecord } from "@/lib/api";
import { getStoredToken } from "@/lib/api";

interface LogData {
  runId: string;
  jobName: string;
  content: string;
  offset: number;
}

interface SSEContextValue {
  runs: RunRecord[];
  connected: boolean;
  logs: Record<string, string>;
}

const SSEContext = createContext<SSEContextValue>({
  runs: [],
  connected: false,
  logs: {},
});

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<Record<string, string>>({});
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    function connect() {
      const token = getStoredToken();
      const params = token ? `?token=${encodeURIComponent(token)}` : "";
      const es = new EventSource(`/api/events${params}`);
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnected(true);
        // Reset logs on reconnect — server restarts offsets from 0,
        // so stale accumulated data would cause duplicates
        setLogs({});
      };
      es.onerror = () => setConnected(false);

      es.addEventListener("status", (e) => {
        try {
          const data = JSON.parse(e.data) as RunRecord[];
          setRuns(data);
        } catch {}
      });

      es.addEventListener("log", (e) => {
        try {
          const data = JSON.parse(e.data) as LogData;
          // Use offset to place content correctly, avoiding duplicates
          setLogs((prev) => {
            const existing = prev[data.runId] || "";
            if (data.offset === 0) {
              // Fresh stream — replace entirely
              return { ...prev, [data.runId]: data.content };
            }
            if (data.offset < existing.length) {
              // Already have this data (reconnect overlap) — skip
              return prev;
            }
            return { ...prev, [data.runId]: existing + data.content };
          });
        } catch {}
      });
    }

    connect();

    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  return (
    <SSEContext.Provider value={{ runs, connected, logs }}>
      {children}
    </SSEContext.Provider>
  );
}

export function useSSE() {
  return useContext(SSEContext);
}
