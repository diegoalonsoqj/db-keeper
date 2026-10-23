import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

const repo = vi.hoisted(() => ({ findDue: vi.fn(), claimRun: vi.fn(), findTargetName: vi.fn() }));
const groups = vi.hoisted(() => ({ runGroup: vi.fn() }));
const backups = vi.hoisted(() => ({ runScheduled: vi.fn() }));
const notif = vi.hoisted(() => ({ notifyScheduleFailure: vi.fn() }));
vi.mock("../src/modules/backups/schedules.repository.js", () => repo);
vi.mock("../src/modules/groups/groups.service.js", () => groups);
vi.mock("../src/modules/backups/backups.service.js", () => backups);
vi.mock("../src/modules/notifications/notifications.service.js", () => notif);
vi.mock("../src/modules/backups/retention.js", () => ({ sweepRetention: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../src/modules/backups/freshness.js", () => ({ checkFreshness: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../src/modules/backups/disk-watch.js", () => ({ checkBackupDisk: vi.fn().mockResolvedValue(undefined) }));

import { tick } from "../src/modules/backups/scheduler.js";

const due = {
  id: "0a1b2c3d-0000-0000-0000-000000000000",
  jobId: null,
  groupId: "g1",
  mode: "recurring",
  cron: "0 17 * * 2,4,6",
  timezone: "America/Lima",
  nextRunAt: "2026-10-22T22:00:00.000Z",
};

describe("scheduler: disparo fallido", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.findDue.mockResolvedValue([due]);
    repo.claimRun.mockResolvedValue(true);
    notif.notifyScheduleFailure.mockResolvedValue(undefined);
  });

  it("avisa en el momento con el nombre del grupo y el motivo", async () => {
    groups.runGroup.mockRejectedValue(new Error("canceling statement due to lock timeout"));
    repo.findTargetName.mockResolvedValue("Backups M-J-S");
    await tick();
    await vi.waitFor(() => expect(notif.notifyScheduleFailure).toHaveBeenCalledTimes(1));
    expect(notif.notifyScheduleFailure).toHaveBeenCalledWith({
      kind: "Grupo",
      name: "Backups M-J-S",
      scheduledAt: new Date(due.nextRunAt),
      error: "canceling statement due to lock timeout",
    });
  });

  it("si no puede leer el nombre, usa el código de la programación", async () => {
    groups.runGroup.mockRejectedValue(new Error("x"));
    repo.findTargetName.mockRejectedValue(new Error("sin BD"));
    await tick();
    await vi.waitFor(() => expect(notif.notifyScheduleFailure).toHaveBeenCalledTimes(1));
    expect(notif.notifyScheduleFailure.mock.calls[0]![0].name).toBe("programación #0A1B2C3D");
  });

  it("un disparo correcto o ya reservado por otro no avisa", async () => {
    groups.runGroup.mockResolvedValue({ executionIds: ["e1"], skipped: [] });
    await tick();
    repo.claimRun.mockResolvedValue(false);
    await tick();
    expect(groups.runGroup).toHaveBeenCalledTimes(1);
    expect(notif.notifyScheduleFailure).not.toHaveBeenCalled();
  });
});
