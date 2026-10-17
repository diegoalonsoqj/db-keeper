import { beforeEach, describe, expect, it, vi } from "vitest";

// El servicio importa la config al cargarse: valores mínimos de prueba.
vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

const repo = vi.hoisted(() => ({ findWatchedSchedules: vi.fn(), findFireStatus: vi.fn(), markStaleAlerted: vi.fn() }));
const settings = vi.hoisted(() => ({ getBackupSettings: vi.fn() }));
const notif = vi.hoisted(() => ({ notifyStaleJobs: vi.fn() }));

vi.mock("../src/modules/backups/freshness.repository.js", () => repo);
vi.mock("../src/modules/settings/settings.service.js", () => settings);
vi.mock("../src/modules/notifications/notifications.service.js", () => notif);

import { checkFreshness, expectedFires } from "../src/modules/backups/freshness.js";
import type { WatchedSchedule } from "../src/modules/backups/freshness.repository.js";

const H = 3_600_000;
const sched = (over: Partial<WatchedSchedule> = {}): WatchedSchedule => ({
  jobId: "j1",
  jobName: "BK ventas",
  cron: "0 2 * * *", // diario 02:00
  timezone: "UTC",
  since: new Date("2026-01-01T00:00:00Z"),
  alertedFireAt: null,
  ...over,
});

describe("expectedFires", () => {
  it("toma el último disparo anterior a now - margen", () => {
    const [f] = expectedFires([sched()], new Date("2026-10-16T06:00:00Z"), 3 * H);
    expect(f!.fireAt.toISOString()).toBe("2026-10-16T02:00:00.000Z");
  });

  it("dentro del margen todavía exige el disparo anterior", () => {
    const [f] = expectedFires([sched()], new Date("2026-10-16T04:00:00Z"), 3 * H);
    expect(f!.fireAt.toISOString()).toBe("2026-10-15T02:00:00.000Z");
  });

  it("cron de lunes a viernes: el domingo exige el viernes, no el sábado", () => {
    // 2026-10-18 es domingo.
    const [f] = expectedFires([sched({ cron: "0 2 * * 1-5" })], new Date("2026-10-18T12:00:00Z"), 3 * H);
    expect(f!.fireAt.toISOString()).toBe("2026-10-16T02:00:00.000Z");
  });

  it("ignora disparos anteriores a la entrada en vigor", () => {
    expect(expectedFires([sched({ since: new Date("2026-10-16T03:00:00Z") })], new Date("2026-10-16T10:00:00Z"), 3 * H)).toEqual([]);
  });

  it("con varias programaciones usa el disparo más reciente", () => {
    const fires = expectedFires(
      [sched({ cron: "0 2 * * 0" }), sched({ cron: "0 2 * * *" })],
      new Date("2026-10-16T06:00:00Z"),
      3 * H,
    );
    expect(fires).toHaveLength(1);
    expect(fires[0]!.fireAt.toISOString()).toBe("2026-10-16T02:00:00.000Z");
  });

  it("ignora un cron inválido", () => {
    expect(expectedFires([sched({ cron: "no-cron" })], new Date(), 3 * H)).toEqual([]);
  });
});

describe("checkFreshness", () => {
  const now = new Date("2026-10-16T06:00:00Z");
  const fire = new Date("2026-10-16T02:00:00Z");

  beforeEach(() => {
    vi.clearAllMocks();
    settings.getBackupSettings.mockResolvedValue({ staleAlertGraceHours: 3 });
    repo.findWatchedSchedules.mockResolvedValue([sched()]);
    repo.findFireStatus.mockResolvedValue([{ jobId: "j1", succeeded: false, inProgress: false, lastSuccessAt: null }]);
  });

  it("avisa y registra el disparo cuando no hubo backup correcto", async () => {
    await checkFreshness(now);
    expect(repo.markStaleAlerted).toHaveBeenCalledWith([{ jobId: "j1", fireAt: fire }]);
    expect(notif.notifyStaleJobs).toHaveBeenCalledWith([expect.objectContaining({ jobName: "BK ventas", expectedAt: fire })], 3);
  });

  it.each([
    ["hubo backup correcto", { succeeded: true, inProgress: false }],
    ["sigue en cola o en curso", { succeeded: false, inProgress: true }],
  ])("no avisa si %s", async (_label, st) => {
    repo.findFireStatus.mockResolvedValue([{ jobId: "j1", lastSuccessAt: null, ...st }]);
    await checkFreshness(now);
    expect(notif.notifyStaleJobs).not.toHaveBeenCalled();
  });

  it("no repite el aviso del mismo disparo", async () => {
    repo.findWatchedSchedules.mockResolvedValue([sched({ alertedFireAt: fire })]);
    await checkFreshness(now);
    expect(repo.findFireStatus).not.toHaveBeenCalled();
    expect(notif.notifyStaleJobs).not.toHaveBeenCalled();
  });

  it("vuelve a avisar en un disparo nuevo que también falte", async () => {
    repo.findWatchedSchedules.mockResolvedValue([sched({ alertedFireAt: new Date("2026-10-15T02:00:00Z") })]);
    await checkFreshness(now);
    expect(notif.notifyStaleJobs).toHaveBeenCalledOnce();
  });

  it("margen 0 = desactivada", async () => {
    settings.getBackupSettings.mockResolvedValue({ staleAlertGraceHours: 0 });
    await checkFreshness(now);
    expect(repo.findWatchedSchedules).not.toHaveBeenCalled();
  });

  it("nunca lanza", async () => {
    repo.findWatchedSchedules.mockRejectedValue(new Error("db"));
    await expect(checkFreshness(now)).resolves.toBeUndefined();
  });
});
