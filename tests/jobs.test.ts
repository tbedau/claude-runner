import {
  describe,
  test,
  expect,
  beforeEach,
  afterAll,
  mock,
} from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
  rmSync,
} from "fs";
import { load as loadYaml } from "js-yaml";
import { join } from "path";
import { tmpdir } from "os";

// --- Set up isolated temp directory and mock config at file scope ---
// This MUST happen before importing jobs.ts so JOBS_DIR resolves to our temp dir.
const BASE_TMP = mkdtempSync(join(tmpdir(), "claude-runner-test-"));
const TEST_JOBS_DIR = join(BASE_TMP, "jobs");
mkdirSync(TEST_JOBS_DIR, { recursive: true });

// Create a no-op setup.sh so syncSchedule doesn't error
writeFileSync(join(BASE_TMP, "setup.sh"), "#!/bin/bash\nexit 0\n", {
  mode: 0o755,
});

mock.module("../server/lib/config", () => ({
  SCRIPT_DIR: BASE_TMP,
  expandHome: (p: string) => p.replace(/^~/, process.env.HOME || ""),
  config: { state_file: join(BASE_TMP, "state.json") },
  loadConfig: () => ({}),
  PORT: 7429,
  AUTH_TOKEN: "",
}));

// Import AFTER mock so jobs.ts picks up mocked SCRIPT_DIR
const {
  validateJobName,
  listJobs,
  getJobDefinition,
  getJobInfo,
  createJob,
  updateJob,
  deleteJob,
  toggleJob,
} = await import("../server/lib/jobs");

const { expandHome } = await import("../server/lib/config");

// --- Pure function tests ---

describe("validateJobName", () => {
  test("accepts valid names", () => {
    expect(validateJobName("my-job-1")).toBe(true);
    expect(validateJobName("a")).toBe(true);
    expect(validateJobName("test-123")).toBe(true);
  });

  test("rejects invalid names", () => {
    expect(validateJobName("My Job")).toBe(false);
    expect(validateJobName("../etc")).toBe(false);
    expect(validateJobName("")).toBe(false);
    expect(validateJobName("a/b")).toBe(false);
    expect(validateJobName("a.b")).toBe(false);
  });
});

describe("expandHome", () => {
  test("expands ~ to HOME", () => {
    expect(expandHome("~/foo")).toBe(`${process.env.HOME}/foo`);
  });

  test("leaves absolute paths unchanged", () => {
    expect(expandHome("/abs/path")).toBe("/abs/path");
  });
});

// --- Job CRUD tests (isolated temp directory) ---

describe("job CRUD", () => {
  beforeEach(() => {
    // Clean all files from jobs dir between tests
    for (const f of readdirSync(TEST_JOBS_DIR)) {
      unlinkSync(join(TEST_JOBS_DIR, f));
    }
  });

  afterAll(() => {
    rmSync(BASE_TMP, { recursive: true, force: true });
  });

  test("listJobs returns [] for empty dir", () => {
    expect(listJobs()).toEqual([]);
  });

  test("listJobs returns correct names after creating files", () => {
    writeFileSync(join(TEST_JOBS_DIR, "alpha.yaml"), "prompt: hello\n");
    writeFileSync(join(TEST_JOBS_DIR, "beta.yaml"), "prompt: world\n");
    const names = listJobs().sort();
    expect(names).toEqual(["alpha", "beta"]);
  });

  test("getJobDefinition returns parsed YAML", () => {
    writeFileSync(
      join(TEST_JOBS_DIR, "myjob.yaml"),
      "prompt: test prompt\nschedule: '0 7 * * *'\n"
    );
    const def = getJobDefinition("myjob");
    expect(def).not.toBeNull();
    expect(def!.prompt).toBe("test prompt");
    expect(def!.schedule).toBe("0 7 * * *");
  });

  test("getJobDefinition returns null for missing job", () => {
    expect(getJobDefinition("nonexistent")).toBeNull();
  });

  test("createJob creates file", () => {
    const result = createJob("newjob", "prompt: hello\n");
    expect(result.ok).toBe(true);
    expect(existsSync(join(TEST_JOBS_DIR, "newjob.yaml"))).toBe(true);
  });

  test("createJob rejects duplicate names", () => {
    writeFileSync(join(TEST_JOBS_DIR, "dup.yaml"), "prompt: existing\n");
    const result = createJob("dup", "prompt: new\n");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("already exists");
  });

  test("createJob rejects invalid YAML", () => {
    const result = createJob("badjob", "{{invalid yaml");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid YAML");
  });

  test("updateJob updates file content", () => {
    writeFileSync(join(TEST_JOBS_DIR, "upd.yaml"), "prompt: old\n");
    const result = updateJob("upd", "prompt: new\n");
    expect(result.ok).toBe(true);
    const def = getJobDefinition("upd");
    expect(def!.prompt).toBe("new");
  });

  test("updateJob rejects missing job", () => {
    const result = updateJob("ghost", "prompt: test\n");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  test("deleteJob deletes file", () => {
    writeFileSync(join(TEST_JOBS_DIR, "del.yaml"), "prompt: bye\n");
    const result = deleteJob("del");
    expect(result.ok).toBe(true);
    expect(existsSync(join(TEST_JOBS_DIR, "del.yaml"))).toBe(false);
  });

  test("deleteJob rejects missing job", () => {
    const result = deleteJob("nope");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  test("deleteJob rejects running job (lockfile exists)", () => {
    writeFileSync(join(TEST_JOBS_DIR, "running.yaml"), "prompt: busy\n");
    const lockDir = join(process.env.HOME || "", ".claude-runner", "locks");
    mkdirSync(lockDir, { recursive: true });
    const lockFile = join(lockDir, "running.lock");
    writeFileSync(lockFile, "");
    try {
      const result = deleteJob("running");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("currently running");
    } finally {
      try {
        unlinkSync(lockFile);
      } catch {}
    }
  });
});

// --- Toggle / enabled tests ---

describe("toggleJob", () => {
  beforeEach(() => {
    mkdirSync(TEST_JOBS_DIR, { recursive: true });
    if (!existsSync(join(BASE_TMP, "setup.sh"))) {
      writeFileSync(join(BASE_TMP, "setup.sh"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
    }
    for (const f of readdirSync(TEST_JOBS_DIR)) {
      unlinkSync(join(TEST_JOBS_DIR, f));
    }
  });

  test("toggleJob on enabled job sets enabled: false", () => {
    writeFileSync(
      join(TEST_JOBS_DIR, "toggle-on.yaml"),
      "prompt: hello\nschedule: '0 7 * * *'\n"
    );
    const result = toggleJob("toggle-on");
    expect(result.ok).toBe(true);
    expect(result.enabled).toBe(false);

    const raw = readFileSync(join(TEST_JOBS_DIR, "toggle-on.yaml"), "utf8");
    const parsed = loadYaml(raw) as Record<string, any>;
    expect(parsed.enabled).toBe(false);
  });

  test("toggleJob on disabled job removes enabled field", () => {
    writeFileSync(
      join(TEST_JOBS_DIR, "toggle-off.yaml"),
      "prompt: hello\nenabled: false\n"
    );
    const result = toggleJob("toggle-off");
    expect(result.ok).toBe(true);
    expect(result.enabled).toBe(true);

    const raw = readFileSync(join(TEST_JOBS_DIR, "toggle-off.yaml"), "utf8");
    const parsed = loadYaml(raw) as Record<string, any>;
    expect(parsed.enabled).toBeUndefined();
  });

  test("toggleJob on missing job returns error", () => {
    const result = toggleJob("nonexistent");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });
});

describe("enabled field defaults", () => {
  beforeEach(() => {
    mkdirSync(TEST_JOBS_DIR, { recursive: true });
    for (const f of readdirSync(TEST_JOBS_DIR)) {
      unlinkSync(join(TEST_JOBS_DIR, f));
    }
  });

  test("getJobDefinition job without enabled field has enabled !== false", () => {
    writeFileSync(join(TEST_JOBS_DIR, "no-enabled.yaml"), "prompt: test\n");
    const def = getJobDefinition("no-enabled");
    expect(def).not.toBeNull();
    expect(def!.enabled !== false).toBe(true);
  });

  test("getJobInfo includes enabled: true for normal jobs", () => {
    writeFileSync(join(TEST_JOBS_DIR, "normal.yaml"), "prompt: test\n");
    const info = getJobInfo("normal");
    expect(info).not.toBeNull();
    expect(info!.enabled).toBe(true);
  });

  test("getJobInfo includes enabled: false for paused jobs", () => {
    writeFileSync(
      join(TEST_JOBS_DIR, "paused.yaml"),
      "prompt: test\nenabled: false\n"
    );
    const info = getJobInfo("paused");
    expect(info).not.toBeNull();
    expect(info!.enabled).toBe(false);
  });
});
