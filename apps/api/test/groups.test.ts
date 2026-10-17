import { beforeEach, describe, expect, it, vi } from "vitest";

// El servicio importa la config al cargarse: valores mínimos de prueba.
vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

const repo = vi.hoisted(() => ({
  findById: vi.fn(),
  findMembersForRun: vi.fn(),
  createGroupExecutions: vi.fn(),
}));
const queue = vi.hoisted(() => ({ enqueueExecution: vi.fn() }));
const notif = vi.hoisted(() => ({ notifyGroupRun: vi.fn() }));

vi.mock("../src/modules/groups/groups.repository.js", () => repo);
vi.mock("../src/modules/backups/engine/queue.js", () => queue);
vi.mock("../src/modules/notifications/notifications.service.js", () => notif);

import { runGroup } from "../src/modules/groups/groups.service.js";
import type { RunnableMember } from "../src/modules/groups/groups.repository.js";

const GROUP = { id: "g1", name: "Nocturno PRD", isActive: true, notifyStart: false, notifyMode: "summary", members: [] };
const member = (name: string, over: Partial<RunnableMember> = {}): RunnableMember => ({
  jobId: `job-${name}`,
  name,
  method: "dump",
  environment: "PRD",
  isActive: true,
  databases: ["db"],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  repo.findById.mockResolvedValue(GROUP);
  repo.createGroupExecutions.mockImplementation(async (_g, members: RunnableMember[]) => ({
    runId: "run-1",
    executionIds: members.map((m) => `exec-${m.name}`),
  }));
});

describe("runGroup", () => {
  it("crea una ejecución por evento activo, en el orden del repositorio, y avisa a la cola", async () => {
    const members = [member("export", { method: "cloudsql_export" }), member("a"), member("b")];
    repo.findMembersForRun.mockResolvedValue(members);

    const r = await runGroup("g1", "scheduled");

    expect(repo.createGroupExecutions).toHaveBeenCalledWith(
      { id: "g1", name: "Nocturno PRD", notifyMode: "summary" },
      members,
      "scheduled",
      [],
    );
    expect(r).toEqual({ executionIds: ["exec-export", "exec-a", "exec-b"], skipped: [] });
    expect(queue.enqueueExecution).toHaveBeenCalledOnce();
  });

  it("omite los eventos inactivos o sin BDs y los informa", async () => {
    repo.findMembersForRun.mockResolvedValue([member("a"), member("off", { isActive: false }), member("vacio", { databases: [] })]);

    const r = await runGroup("g1", "manual");

    expect(repo.createGroupExecutions.mock.calls[0]![1].map((m: RunnableMember) => m.name)).toEqual(["a"]);
    expect(r.skipped).toEqual(["off", "vacio"]);
    expect(repo.createGroupExecutions.mock.calls[0]![3]).toEqual(["off", "vacio"]);
  });

  it("sin notifyStart no avisa el inicio", async () => {
    repo.findMembersForRun.mockResolvedValue([member("a")]);
    await runGroup("g1", "manual");
    expect(notif.notifyGroupRun).not.toHaveBeenCalled();
  });

  it("con notifyStart avisa el inicio con los eventos en cola y los omitidos", async () => {
    repo.findById.mockResolvedValue({ ...GROUP, notifyStart: true });
    repo.findMembersForRun.mockResolvedValue([member("a", { databases: ["x", "y"] }), member("off", { isActive: false })]);

    await runGroup("g1", "manual");

    expect(notif.notifyGroupRun).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "start",
        runId: "run-1",
        group: "Nocturno PRD",
        events: [
          { name: "a", status: "queued", dbCount: 2 },
          { name: "off", status: "skipped" },
        ],
      }),
    );
  });

  it("falla si no queda ningún evento ejecutable", async () => {
    repo.findMembersForRun.mockResolvedValue([member("off", { isActive: false })]);

    await expect(runGroup("g1", "manual")).rejects.toThrow(/no tiene eventos activos/);
    expect(repo.createGroupExecutions).not.toHaveBeenCalled();
    expect(queue.enqueueExecution).not.toHaveBeenCalled();
  });

  it("un grupo inactivo no se dispara por programación, pero sí a mano", async () => {
    repo.findById.mockResolvedValue({ ...GROUP, isActive: false });
    repo.findMembersForRun.mockResolvedValue([member("a")]);

    expect(await runGroup("g1", "scheduled")).toEqual({ executionIds: [], skipped: [] });
    expect(repo.createGroupExecutions).not.toHaveBeenCalled();

    expect((await runGroup("g1", "manual")).executionIds).toEqual(["exec-a"]);
  });

  it("404 si el grupo no existe", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(runGroup("x", "manual")).rejects.toThrow(/Grupo no encontrado/);
  });
});
