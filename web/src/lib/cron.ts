const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Expand a single cron field token (number, range, or range with step) into an array of ints. */
function expandToken(token: string, max: number): number[] {
  if (token.includes("/")) {
    const [rangePart, stepStr] = token.split("/");
    const step = parseInt(stepStr, 10);
    const [start, end] =
      rangePart === "*"
        ? [0, max]
        : rangePart.includes("-")
          ? rangePart.split("-").map((n) => parseInt(n, 10))
          : [parseInt(rangePart, 10), max];
    const result: number[] = [];
    for (let i = start; i <= end; i += step) result.push(i);
    return result;
  }
  if (token.includes("-")) {
    const [start, end] = token.split("-").map((n) => parseInt(n, 10));
    const result: number[] = [];
    for (let i = start; i <= end; i++) result.push(i);
    return result;
  }
  return [parseInt(token, 10)];
}

/** Expand a full cron field (commas, ranges, steps) into sorted unique ints. */
function expandField(field: string, max: number): number[] {
  if (field === "*") return [];
  const values = new Set<number>();
  for (const token of field.split(",")) {
    for (const v of expandToken(token, max)) values.add(v);
  }
  return [...values].sort((a, b) => a - b);
}

/** Format a list of day-of-week numbers as a human-readable string. */
function formatDays(nums: number[]): string {
  if (nums.length === 7) return "Daily";
  const sorted = [...nums].sort((a, b) => a - b);
  if (
    sorted.length === 5 &&
    sorted[0] === 1 &&
    sorted[4] === 5
  )
    return "Weekdays";
  if (
    sorted.length === 2 &&
    sorted[0] === 0 &&
    sorted[1] === 6
  )
    return "Weekends";
  return sorted.map((d) => DAYS[d] ?? String(d)).join(", ");
}

export function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;

  const pad = (s: string) => s.padStart(2, "0");

  // Simple time display for fixed hour:minute
  const isFixedTime = !hour.includes("/") && !min.includes("/") && !hour.includes("-") && !min.includes("-") && !hour.includes(",") && !min.includes(",") && hour !== "*" && min !== "*";

  if (min.includes("/")) {
    const step = min.split("/")[1];
    return `Every ${step} min`;
  }
  if (hour.includes("/")) {
    const step = hour.split("/")[1];
    return `Every ${step} hours`;
  }

  if (!isFixedTime) return cron;

  const timeStr = `${pad(hour)}:${pad(min)}`;

  if (dom === "*" && mon === "*" && dow === "*") {
    return `Daily at ${timeStr}`;
  }

  if (dom === "*" && mon === "*" && dow !== "*") {
    const dayNums = expandField(dow, 6);
    const dayLabel = formatDays(dayNums);
    if (dayLabel === "Daily") return `Daily at ${timeStr}`;
    return `${dayLabel} at ${timeStr}`;
  }

  return cron;
}
