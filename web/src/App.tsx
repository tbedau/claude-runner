import { Routes, Route } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import Dashboard from "@/pages/Dashboard";
import Jobs from "@/pages/Jobs";
import JobEditor from "@/pages/JobEditor";
import Runs from "@/pages/Runs";
import LogViewer from "@/pages/LogViewer";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/new" element={<JobEditor />} />
        <Route path="/jobs/:name" element={<JobEditor />} />
        <Route path="/runs" element={<Runs />} />
        <Route path="/runs/:runId" element={<LogViewer />} />
      </Route>
    </Routes>
  );
}
