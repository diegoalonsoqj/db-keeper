import { describe, expect, it } from "vitest";
import { nextRunForCron, prevRunForCron } from "../src/modules/backups/schedule-time.js";

const TZ = "America/Lima"; // UTC-5, sin horario de verano
const FIRST_AND_THIRD_SUNDAY = "0 2 * * 0#1 | 0 2 * * 0#3";

/** Disparos sucesivos como fecha local (YYYY-MM-DD) en Lima. */
function nextRuns(cron: string, from: Date, n: number): string[] {
  const out: string[] = [];
  let at = from;
  for (let i = 0; i < n; i++) {
    at = nextRunForCron(cron, TZ, at);
    out.push(new Date(at.getTime() - 5 * 3_600_000).toISOString().slice(0, 10));
  }
  return out;
}

describe("schedule-time: varias expresiones con |", () => {
  it("next combina 1.º y 3.º domingo en orden", () => {
    expect(nextRuns(FIRST_AND_THIRD_SUNDAY, new Date("2026-10-19T12:00:00Z"), 6)).toEqual([
      "2026-11-01",
      "2026-11-15",
      "2026-12-06",
      "2026-12-20",
      "2027-01-03",
      "2027-01-17",
    ]);
  });

  it("prev devuelve el disparo más reciente de cualquiera", () => {
    // 2026-11-10 → el último fue el 1.º domingo (01/11 02:00 Lima = 07:00 UTC)
    expect(prevRunForCron(FIRST_AND_THIRD_SUNDAY, TZ, new Date("2026-11-10T12:00:00Z")).toISOString()).toBe(
      "2026-11-01T07:00:00.000Z",
    );
    // 2026-11-20 → el último fue el 3.º domingo (15/11)
    expect(prevRunForCron(FIRST_AND_THIRD_SUNDAY, TZ, new Date("2026-11-20T12:00:00Z")).toISOString()).toBe(
      "2026-11-15T07:00:00.000Z",
    );
  });

  it("una sola expresión se comporta igual que antes", () => {
    expect(nextRuns("0 21 * * *", new Date("2026-10-19T12:00:00Z"), 2)).toEqual(["2026-10-19", "2026-10-20"]);
  });

  it("rechaza expresiones vacías o inválidas", () => {
    expect(() => nextRunForCron("0 2 * * 0#1 |", TZ, new Date())).toThrow("Expresión cron inválida");
    expect(() => nextRunForCron("0 2 * * 0#1 | basura", TZ, new Date())).toThrow("Expresión cron inválida");
    expect(() => prevRunForCron("|", TZ, new Date())).toThrow();
  });
});
