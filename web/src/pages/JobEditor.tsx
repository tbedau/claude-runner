import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Save, Loader2, Webhook, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import CodeMirror from "@uiw/react-codemirror";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

const TEMPLATE_YAML = `name: my-job
prompt: |
  Your prompt here. Claude will execute this
  with --dangerously-skip-permissions.
schedule: "0 7 * * *"
retries: 0
timeout: 300
notify: true
workdir: ~/my-project
`;

interface JobFields {
  name: string;
  prompt: string;
  schedule: string;
  retries: number;
  timeout: string;
  notify: boolean;
  workdir: string;
  enabled: boolean;
}

function yamlToFields(yaml: string): JobFields {
  try {
    const parsed = loadYaml(yaml) as Record<string, any>;
    return {
      name: parsed.name || "",
      prompt: parsed.prompt || "",
      schedule: parsed.schedule || "",
      retries: parsed.retries ?? 0,
      timeout: parsed.timeout ? String(parsed.timeout) : "",
      notify: parsed.notify !== false,
      workdir: parsed.workdir || "",
      enabled: parsed.enabled !== false,
    };
  } catch {
    return {
      name: "",
      prompt: "",
      schedule: "",
      retries: 0,
      timeout: "",
      notify: true,
      workdir: "",
      enabled: true,
    };
  }
}

function fieldsToYaml(fields: JobFields): string {
  const obj: Record<string, any> = {
    name: fields.name,
    prompt: fields.prompt,
  };
  if (fields.schedule) obj.schedule = fields.schedule;
  if (fields.retries > 0) obj.retries = fields.retries;
  if (fields.timeout) obj.timeout = parseInt(fields.timeout, 10);
  if (!fields.notify) obj.notify = false;
  if (fields.workdir) obj.workdir = fields.workdir;
  if (!fields.enabled) obj.enabled = false;
  return dumpYaml(obj, { lineWidth: -1 });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleCopy}>
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
    </Button>
  );
}

export default function JobEditor() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const isNew = !name;
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [yaml, setYaml] = useState(isNew ? TEMPLATE_YAML : "");
  const [fields, setFields] = useState<JobFields>(
    isNew ? yamlToFields(TEMPLATE_YAML) : yamlToFields("")
  );
  const [activeTab, setActiveTab] = useState<"form" | "yaml">("form");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!name) return;
    api
      .getJob(name)
      .then((data) => {
        setYaml(data.yaml || "");
        setFields(yamlToFields(data.yaml || ""));
      })
      .catch(() => toast.error("Failed to load job"))
      .finally(() => setLoading(false));
  }, [name]);

  // When form fields change → update YAML (debounced)
  const updateYamlFromFields = useCallback((newFields: JobFields) => {
    setFields(newFields);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setYaml(fieldsToYaml(newFields));
    }, 300);
  }, []);

  // When YAML changes → update fields (debounced)
  const updateFieldsFromYaml = useCallback((newYaml: string) => {
    setYaml(newYaml);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFields(yamlToFields(newYaml));
    }, 300);
  }, []);

  function updateField(key: keyof JobFields, value: any) {
    const newFields = { ...fields, [key]: value };
    updateYamlFromFields(newFields);
  }

  async function handleSave() {
    const jobName = isNew ? fields.name : name!;
    if (!jobName || !/^[a-z0-9-]+$/.test(jobName)) {
      toast.error("Job name must match [a-z0-9-]+");
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        await api.createJob(jobName, yaml);
        toast.success(`Created ${jobName}`);
        navigate(`/jobs/${jobName}`);
      } else {
        await api.updateJob(jobName, yaml);
        toast.success(`Updated ${jobName}`);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 sm:h-8 sm:w-8"
          onClick={() => navigate("/jobs")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">
            {isNew ? "New Job" : `Edit ${name}`}
          </h1>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          size="sm"
          className="gap-1.5"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {isNew ? "Create" : "Save"}
        </Button>
      </div>

      {/* Mobile tab switcher */}
      <div className="flex gap-1 sm:hidden">
        <Button
          variant={activeTab === "form" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("form")}
          className="flex-1"
        >
          Form
        </Button>
        <Button
          variant={activeTab === "yaml" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("yaml")}
          className="flex-1"
        >
          YAML
        </Button>
      </div>

      {/* Editor panels */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Left: Form fields */}
        <Card className={activeTab === "yaml" ? "hidden sm:block" : ""}>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={fields.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="my-job"
                disabled={!isNew}
                className="font-mono text-sm bg-background"
              />
              <p className="text-[11px] text-muted-foreground">
                Lowercase letters, numbers, and hyphens only.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt">Prompt</Label>
              <Textarea
                id="prompt"
                value={fields.prompt}
                onChange={(e) => updateField("prompt", e.target.value)}
                placeholder="The prompt passed to claude -p..."
                rows={5}
                className="font-mono text-sm bg-background resize-y"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="schedule">Schedule</Label>
              <Input
                id="schedule"
                value={fields.schedule}
                onChange={(e) => updateField("schedule", e.target.value)}
                placeholder="0 7 * * *"
                className="font-mono text-sm bg-background"
              />
              <p className="text-[11px] text-muted-foreground">
                Leave empty for webhook-only jobs.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="retries">Retries</Label>
                <Input
                  id="retries"
                  type="number"
                  min={0}
                  value={fields.retries}
                  onChange={(e) =>
                    updateField("retries", parseInt(e.target.value, 10) || 0)
                  }
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timeout">Timeout (sec)</Label>
                <Input
                  id="timeout"
                  value={fields.timeout}
                  onChange={(e) => updateField("timeout", e.target.value)}
                  placeholder="300"
                  className="bg-background"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="workdir">Working Directory</Label>
              <Input
                id="workdir"
                value={fields.workdir}
                onChange={(e) => updateField("workdir", e.target.value)}
                placeholder="~/my-project"
                className="font-mono text-sm bg-background"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="notify"
                type="checkbox"
                checked={fields.notify}
                onChange={(e) => updateField("notify", e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <Label htmlFor="notify" className="text-sm font-normal">
                Send push notification on completion
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* Right: YAML editor */}
        <Card className={activeTab === "form" ? "hidden sm:block" : ""}>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              YAML
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-input overflow-hidden [&_.cm-editor]:!bg-background [&_.cm-gutters]:!bg-background [&_.cm-gutters]:!border-r-border [&_.cm-editor]:!outline-none [&_.cm-editor.cm-focused]:ring-1 [&_.cm-editor.cm-focused]:ring-ring">
              <CodeMirror
                value={yaml}
                onChange={(value) => updateFieldsFromYaml(value)}
                extensions={[yamlLang()]}
                theme={oneDark}
                minHeight="400px"
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: false,
                  highlightActiveLine: true,
                  bracketMatching: true,
                  indentOnInput: true,
                }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Webhook trigger info (only for existing jobs) */}
      {!isNew && name && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
              <Webhook className="h-3.5 w-3.5" />
              Trigger via API
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Trigger this job from any webhook, CI pipeline, or script using a POST request.
            </p>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Endpoint</Label>
              <div className="flex items-center gap-2 rounded-md bg-muted/50 border px-3 py-2">
                <code className="text-xs font-mono flex-1 break-all">
                  POST {window.location.origin}/api/runs/trigger/{name}
                </code>
                <CopyButton text={`${window.location.origin}/api/runs/trigger/${name}`} />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">curl</Label>
              <div className="flex items-start gap-2 rounded-md bg-muted/50 border px-3 py-2">
                <code className="text-xs font-mono flex-1 break-all whitespace-pre-wrap">{`curl -X POST ${window.location.origin}/api/runs/trigger/${name} \\
  -H "Authorization: Bearer <your-token>"`}</code>
                <CopyButton text={`curl -X POST ${window.location.origin}/api/runs/trigger/${name} \\\n  -H "Authorization: Bearer <your-token>"`} />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Remote (via Tailscale)</Label>
              {(() => {
                const tsUrl = `http://100.111.5.31:${window.location.port || "7429"}/api/runs/trigger/${name}`;
                const tsCurl = `curl -X POST ${tsUrl} \\\n  -H "Authorization: Bearer <your-token>"`;
                return (
                  <div className="flex items-start gap-2 rounded-md bg-muted/50 border px-3 py-2">
                    <code className="text-xs font-mono flex-1 break-all whitespace-pre-wrap">{tsCurl}</code>
                    <CopyButton text={tsCurl} />
                  </div>
                );
              })()}
              <p className="text-[11px] text-muted-foreground">
                Reachable from any device on your Tailnet. No port forwarding or public exposure needed.
              </p>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Returns <code className="text-[11px] font-mono bg-muted px-1 py-0.5 rounded">{"{ runId, jobName, status }"}</code> on success. Auth token required if configured in config.local.yaml.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
