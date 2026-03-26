import { scheduleToMs } from "../agent-runner";

describe("scheduleToMs", () => {
  it("returns 1 hour for 'hourly'", () => {
    expect(scheduleToMs("hourly")).toBe(3_600_000);
  });

  it("returns 1 hour for 'every hour'", () => {
    expect(scheduleToMs("every hour")).toBe(3_600_000);
  });

  it("returns 7 days for 'weekly'", () => {
    expect(scheduleToMs("weekly")).toBe(604_800_000);
  });

  it("parses 'every 5 minutes'", () => {
    expect(scheduleToMs("every 5 minutes")).toBe(5 * 60_000);
  });

  it("parses 'every 30 min'", () => {
    expect(scheduleToMs("every 30 min")).toBe(30 * 60_000);
  });

  it("parses 'every 1 minute'", () => {
    expect(scheduleToMs("every 1 minute")).toBe(60_000);
  });

  it("parses 'every 2 hours'", () => {
    expect(scheduleToMs("every 2 hours")).toBe(2 * 3_600_000);
  });

  it("falls back to daily for 'every 0 minutes'", () => {
    expect(scheduleToMs("every 0 minutes")).toBe(86_400_000);
  });

  it("falls back to daily for 'every 0 hours'", () => {
    expect(scheduleToMs("every 0 hours")).toBe(86_400_000);
  });

  it("does not match 'every 5 minimum'", () => {
    // 'minimum' should not be parsed as minutes — falls through to daily
    expect(scheduleToMs("every 5 minimum")).toBe(86_400_000);
  });

  it("falls back to daily for unknown schedule", () => {
    expect(scheduleToMs("whenever I feel like it")).toBe(86_400_000);
  });

  it("minutes takes precedence over hours when both could match", () => {
    expect(scheduleToMs("every 10 minutes")).toBe(10 * 60_000);
  });
});
