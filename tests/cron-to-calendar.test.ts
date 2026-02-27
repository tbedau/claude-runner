import { describe, test, expect } from "bun:test";
import { join } from "path";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";

const SETUP_SH = join(import.meta.dir, "../setup.sh");

function cronToCalendar(cronExpr: string): string {
  const script = `source "${SETUP_SH}" && cron_to_calendar_interval "${cronExpr}"`;
  const result = Bun.spawnSync(["bash", "-c", script]);
  if (result.exitCode !== 0) {
    throw new Error(
      `Shell exited ${result.exitCode}: ${result.stderr.toString()}`
    );
  }
  return result.stdout.toString();
}

function countDicts(output: string): number {
  return (output.match(/<dict>/g) || []).length;
}

function extractKeys(output: string, dictIndex = 0): string[] {
  const dicts = output.split("<dict>").slice(1);
  const dict = dicts[dictIndex] || "";
  const keys: string[] = [];
  const re = /<key>(\w+)<\/key>/g;
  let m;
  while ((m = re.exec(dict)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

describe("cron_to_calendar_interval", () => {
  test("0 7 * * * → single dict with only Minute and Hour", () => {
    const output = cronToCalendar("0 7 * * *");
    expect(countDicts(output)).toBe(1);
    const keys = extractKeys(output);
    expect(keys).toEqual(["Minute", "Hour"]);
    expect(output).toContain("<integer>0</integer>");
    expect(output).toContain("<integer>7</integer>");
    expect(output).not.toContain("Day");
    expect(output).not.toContain("Month");
    expect(output).not.toContain("Weekday");
  });

  test("glob safety — no <integer> tag contains a non-numeric value", () => {
    const expressions = [
      "0 7 * * *",
      "*/15 * * * *",
      "0 9-11 * * *",
      "0 8,12,18 * * *",
      "0 9 * * 1-5",
      "30 14 1 6 3",
      "* * * * *",
    ];
    for (const expr of expressions) {
      const output = cronToCalendar(expr);
      const integers = [...output.matchAll(/<integer>(.*?)<\/integer>/g)].map(
        (m) => m[1]
      );
      for (const val of integers) {
        expect(val).toMatch(/^\d+$/);
      }
    }
  });

  test("*/15 * * * * → 4 dicts (minutes 0, 15, 30, 45)", () => {
    const output = cronToCalendar("*/15 * * * *");
    expect(countDicts(output)).toBe(4);
    expect(output).toContain("<integer>0</integer>");
    expect(output).toContain("<integer>15</integer>");
    expect(output).toContain("<integer>30</integer>");
    expect(output).toContain("<integer>45</integer>");
  });

  test("0 9-11 * * * → 3 dicts (hours 9, 10, 11)", () => {
    const output = cronToCalendar("0 9-11 * * *");
    expect(countDicts(output)).toBe(3);
    expect(output).toContain("<integer>9</integer>");
    expect(output).toContain("<integer>10</integer>");
    expect(output).toContain("<integer>11</integer>");
  });

  test("0 8,12,18 * * * → 3 dicts", () => {
    const output = cronToCalendar("0 8,12,18 * * *");
    expect(countDicts(output)).toBe(3);
    expect(output).toContain("<integer>8</integer>");
    expect(output).toContain("<integer>12</integer>");
    expect(output).toContain("<integer>18</integer>");
  });

  test("0 9 * * 1-5 → 5 dicts with Weekday keys", () => {
    const output = cronToCalendar("0 9 * * 1-5");
    expect(countDicts(output)).toBe(5);
    for (const dict of output.split("<dict>").slice(1)) {
      expect(dict).toContain("<key>Weekday</key>");
    }
  });

  test("30 14 1 6 3 → single dict with all 5 keys", () => {
    const output = cronToCalendar("30 14 1 6 3");
    expect(countDicts(output)).toBe(1);
    const keys = extractKeys(output);
    expect(keys).toEqual(["Minute", "Hour", "Day", "Month", "Weekday"]);
  });

  test("* * * * * → single dict with no keys (empty body)", () => {
    const output = cronToCalendar("* * * * *");
    expect(countDicts(output)).toBe(1);
    expect(output).not.toContain("<key>");
  });

  test("*/10 9-17 * * 1-5 → 270 dicts", () => {
    const output = cronToCalendar("*/10 9-17 * * 1-5");
    expect(countDicts(output)).toBe(270);
  });
});

// --- setup.sh schedule+enabled YAML parsing ---
// Reproduces the exact read logic from setup.sh to catch delimiter bugs.

function parseJobYaml(yamlContent: string): { schedule: string; enabled: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), "setup-parse-test-"));
  const yamlFile = join(tmpDir, "test.yaml");
  writeFileSync(yamlFile, yamlContent);

  // Same logic as setup.sh: bun one-liner with pipe delimiter + bash read
  const script = `
    IFS='|' read -r SCHEDULE ENABLED <<< "$(bun -e "
      const y = require('js-yaml');
      const fs = require('fs');
      const c = y.load(fs.readFileSync('${yamlFile}', 'utf8')) || {};
      const schedule = c.schedule || '';
      const enabled = c.enabled === false ? 'false' : 'true';
      process.stdout.write(schedule + '|' + enabled);
    ")"
    printf '%s|%s' "$SCHEDULE" "$ENABLED"
  `;

  const result = Bun.spawnSync(["bash", "-c", script]);
  rmSync(tmpDir, { recursive: true, force: true });

  if (result.exitCode !== 0) {
    throw new Error(`Shell exited ${result.exitCode}: ${result.stderr.toString()}`);
  }

  const [schedule, enabled] = result.stdout.toString().split("|");
  return { schedule, enabled };
}

describe("setup.sh schedule+enabled parsing", () => {
  test("cron with spaces is preserved intact", () => {
    const { schedule, enabled } = parseJobYaml(
      "prompt: test\nschedule: '10 2 * * *'\n"
    );
    expect(schedule).toBe("10 2 * * *");
    expect(enabled).toBe("true");
  });

  test("complex cron expression is not split", () => {
    const { schedule, enabled } = parseJobYaml(
      "prompt: test\nschedule: '*/15 9-17 * * 1-5'\n"
    );
    expect(schedule).toBe("*/15 9-17 * * 1-5");
    expect(enabled).toBe("true");
  });

  test("enabled: false is read correctly", () => {
    const { schedule, enabled } = parseJobYaml(
      "prompt: test\nschedule: '0 7 * * *'\nenabled: false\n"
    );
    expect(schedule).toBe("0 7 * * *");
    expect(enabled).toBe("false");
  });

  test("missing enabled defaults to true", () => {
    const { schedule, enabled } = parseJobYaml(
      "prompt: test\nschedule: '30 6 * * *'\n"
    );
    expect(schedule).toBe("30 6 * * *");
    expect(enabled).toBe("true");
  });

  test("missing schedule returns empty string", () => {
    const { schedule } = parseJobYaml("prompt: test\n");
    expect(schedule).toBe("");
  });
});
