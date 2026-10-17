import { beforeEach, describe, expect, it, vi } from "vitest";

// El servicio importa la config al cargarse: valores mínimos de prueba.
vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

const runsRepo = vi.hoisted(() => ({ findGroupRunForExecution: vi.fn() }));
const settings = vi.hoisted(() => ({ getNotifRuntimeConfig: vi.fn() }));
const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
const telegram = vi.hoisted(() => ({ sendTelegram: vi.fn() }));
const notifRepo = vi.hoisted(() => ({ findTelegramRoot: vi.fn(), saveTelegramRoot: vi.fn() }));

vi.mock("../src/modules/groups/group-runs.repository.js", () => runsRepo);
vi.mock("../src/modules/settings/settings.service.js", () => settings);
vi.mock("../src/modules/notifications/email.js", () => email);
vi.mock("../src/modules/notifications/telegram.js", () => telegram);
vi.mock("../src/modules/notifications/notifications.repository.js", () => notifRepo);

import {
  groupStatusLine,
  notifyBackup,
  notifyGroupRun,
  type BackupNotification,
  type GroupRunNotification,
} from "../src/modules/notifications/notifications.service.js";
import { shortError } from "../src/modules/groups/group-runs.service.js";

const cfg = {
  notifyOnStart: true,
  notifyOnSuccess: true,
  notifyOnFailure: true,
  email: { enabled: false },
  telegram: { enabled: true, chatId: "1" },
};

const summary = (events: GroupRunNotification["events"]): GroupRunNotification => ({
  event: "summary",
  runId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  group: "Nocturno",
  runAt: new Date(2026, 9, 16, 2, 0),
  durationMs: 125_000,
  events,
});

beforeEach(() => {
  vi.clearAllMocks();
  settings.getNotifRuntimeConfig.mockResolvedValue(cfg);
  telegram.sendTelegram.mockResolvedValue(10);
  notifRepo.findTelegramRoot.mockResolvedValue(null);
  notifRepo.saveTelegramRoot.mockResolvedValue(undefined);
});

describe("resumen de grupo", () => {
  it("estado general según los eventos ejecutados (los omitidos no cuentan)", () => {
    const ok = { name: "a", status: "success" as const };
    const bad = { name: "b", status: "failed" as const, error: "x" };
    const skip = { name: "c", status: "skipped" as const };
    expect(groupStatusLine(summary([ok, skip]))).toMatch(/^Completado — 1 OK · 0 fallidos · 1 omitido/);
    expect(groupStatusLine(summary([ok, bad]))).toMatch(/^Con fallos — 1 OK · 1 fallido/);
    expect(groupStatusLine(summary([bad]))).toMatch(/^Fallido/);
  });

  it("Telegram lista cada evento con su error, escapado", async () => {
    await notifyGroupRun(
      summary([
        { name: "ventas", status: "success", durationMs: 60_000, dbCount: 2, totalBytes: 1024 },
        { name: "legacy", status: "failed", error: "Login failed <user>" },
        { name: "logs", status: "skipped" },
      ]),
    );
    const html = telegram.sendTelegram.mock.calls[0]![1] as string;
    expect(html).toContain("⚠️ Grupo con fallos");
    expect(html).toContain("✅ <b>ventas</b>");
    expect(html).toContain("❌ <b>legacy</b> — Error: Login failed &lt;user&gt;");
    expect(html).toContain("⏭️ <b>logs</b>");
    expect(html).not.toContain("<br>");
  });

  it("Telegram no supera el límite con muchos eventos", async () => {
    const events = Array.from({ length: 200 }, (_, i) => ({ name: `evento-${i}`, status: "failed" as const, error: "e".repeat(150) }));
    await notifyGroupRun(summary(events));
    const html = telegram.sendTelegram.mock.calls[0]![1] as string;
    expect(html.length).toBeLessThanOrEqual(4096);
    expect(html).toMatch(/… y \d+ más/);
  });

  it("respeta las banderas de éxito/fallo de Configuración", async () => {
    settings.getNotifRuntimeConfig.mockResolvedValue({ ...cfg, notifyOnSuccess: false });
    await notifyGroupRun(summary([{ name: "a", status: "success" }]));
    expect(telegram.sendTelegram).not.toHaveBeenCalled();
    await notifyGroupRun(summary([{ name: "a", status: "failed", error: "x" }]));
    expect(telegram.sendTelegram).toHaveBeenCalledOnce();
  });
});

describe("avisos individuales de eventos de un grupo", () => {
  const base: BackupNotification = {
    event: "success",
    executionId: "e1",
    runAt: new Date(),
    group: "Nocturno",
    jobName: "BK",
    engine: "postgres",
    databases: ["a"],
  };

  it.each([
    ["summary", "success", false],
    ["summary", "failure", false],
    ["summary_failures", "start", false],
    ["summary_failures", "failure", true],
    ["all", "success", true],
    [null, "success", true], // ejecución anterior a las corridas de grupo: como siempre
  ] as const)("modo %s, evento %s → envía=%s", async (mode, event, sent) => {
    runsRepo.findGroupRunForExecution.mockResolvedValue(mode ? { runId: "r1", notifyMode: mode } : null);
    await notifyBackup({ ...base, event });
    expect(telegram.sendTelegram.mock.calls.length > 0).toBe(sent);
  });

  it("sin grupo no consulta el modo", async () => {
    await notifyBackup({ ...base, group: null });
    expect(runsRepo.findGroupRunForExecution).not.toHaveBeenCalled();
    expect(telegram.sendTelegram).toHaveBeenCalledOnce();
  });

  it("si falla la lectura del modo, envía (no se pierden avisos)", async () => {
    runsRepo.findGroupRunForExecution.mockRejectedValue(new Error("db"));
    await notifyBackup(base);
    expect(telegram.sendTelegram).toHaveBeenCalledOnce();
  });
});

describe("hilo de Telegram de la corrida", () => {
  const run = { kind: "group_run", id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" };
  const ev: BackupNotification = {
    event: "failure",
    executionId: "e1",
    runAt: new Date(),
    group: "Nocturno",
    jobName: "BK",
    engine: "postgres",
    databases: ["a"],
  };

  it("el primer aviso de la corrida queda como raíz", async () => {
    await notifyGroupRun(summary([{ name: "a", status: "success" }]));
    expect(telegram.sendTelegram).toHaveBeenCalledWith(cfg.telegram, expect.any(String), null);
    expect(notifRepo.saveTelegramRoot).toHaveBeenCalledWith(run, "1", 10);
  });

  it("el resumen y los eventos del grupo responden a la raíz de la corrida", async () => {
    notifRepo.findTelegramRoot.mockResolvedValue({ chatId: "1", messageId: 7 });
    runsRepo.findGroupRunForExecution.mockResolvedValue({ runId: run.id, notifyMode: "all" });
    await notifyBackup(ev);
    await notifyGroupRun(summary([{ name: "a", status: "success" }]));
    expect(notifRepo.findTelegramRoot).toHaveBeenCalledWith(run);
    expect(telegram.sendTelegram.mock.calls.map((c) => c[2])).toEqual([7, 7]);
    expect(notifRepo.saveTelegramRoot).not.toHaveBeenCalled();
  });

  it("un evento sin corrida sigue en el hilo de su ejecución", async () => {
    await notifyBackup({ ...ev, group: null });
    expect(notifRepo.findTelegramRoot).toHaveBeenCalledWith({ kind: "execution", id: "e1" });
  });
});

describe("shortError", () => {
  it("toma la última línea no vacía y la recorta", () => {
    expect(shortError("Método: dump\npg_dump: error: connection refused\n\n")).toBe("pg_dump: error: connection refused");
    expect(shortError("x".repeat(500))).toHaveLength(200);
    expect(shortError(null)).toBe("error");
  });
});
