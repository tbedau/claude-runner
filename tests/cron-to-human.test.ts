import { describe, test, expect } from "bun:test";
import { cronToHuman } from "../web/src/lib/cron";

describe("cronToHuman", () => {
  test("daily schedule", () => {
    expect(cronToHuman("0 7 * * *")).toBe("Daily at 07:00");
    expect(cronToHuman("30 14 * * *")).toBe("Daily at 14:30");
  });

  test("single day of week", () => {
    expect(cronToHuman("0 8 * * 1")).toBe("Mon at 08:00");
    expect(cronToHuman("0 9 * * 0")).toBe("Sun at 09:00");
    expect(cronToHuman("0 17 * * 5")).toBe("Fri at 17:00");
  });

  test("comma-separated days", () => {
    expect(cronToHuman("0 8 * * 1,3,5")).toBe("Mon, Wed, Fri at 08:00");
    expect(cronToHuman("0 9 * * 0,6")).toBe("Weekends at 09:00");
  });

  test("day range (the original bug)", () => {
    expect(cronToHuman("0 8 * * 1-5")).toBe("Weekdays at 08:00");
    expect(cronToHuman("0 9 * * 1-3")).toBe("Mon, Tue, Wed at 09:00");
  });

  test("weekdays shorthand", () => {
    expect(cronToHuman("0 8 * * 1-5")).toBe("Weekdays at 08:00");
    expect(cronToHuman("0 8 * * 1,2,3,4,5")).toBe("Weekdays at 08:00");
  });

  test("weekends shorthand", () => {
    expect(cronToHuman("0 10 * * 0,6")).toBe("Weekends at 10:00");
    expect(cronToHuman("0 10 * * 6,0")).toBe("Weekends at 10:00");
  });

  test("all days range collapses to daily", () => {
    expect(cronToHuman("0 8 * * 0-6")).toBe("Daily at 08:00");
  });

  test("minute step", () => {
    expect(cronToHuman("*/15 * * * *")).toBe("Every 15 min");
    expect(cronToHuman("*/5 * * * *")).toBe("Every 5 min");
  });

  test("hour step", () => {
    expect(cronToHuman("0 */2 * * *")).toBe("Every 2 hours");
    expect(cronToHuman("0 */6 * * *")).toBe("Every 6 hours");
  });

  test("specific dom/mon passes through as raw cron", () => {
    expect(cronToHuman("30 14 1 6 3")).toBe("30 14 1 6 3");
  });

  test("invalid cron passes through unchanged", () => {
    expect(cronToHuman("not a cron")).toBe("not a cron");
    expect(cronToHuman("0 7 * *")).toBe("0 7 * *");
  });

  test("pads single-digit hours and minutes", () => {
    expect(cronToHuman("5 8 * * *")).toBe("Daily at 08:05");
    expect(cronToHuman("0 0 * * *")).toBe("Daily at 00:00");
  });
});
