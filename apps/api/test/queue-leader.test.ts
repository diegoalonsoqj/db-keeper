import { beforeEach, describe, expect, it, vi } from "vitest";

// El servicio importa la config al cargarse: valores mínimos de prueba.
vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

const pool = vi.hoisted(() => ({ query: vi.fn() }));
const leader = vi.hoisted(() => ({ listenAsLeader: vi.fn() }));
const repo = vi.hoisted(() => ({ listQueuedExecutions: vi.fn(), findBusyServerIds: vi.fn() }));
const runner = vi.hoisted(() => ({ runExecution: vi.fn() }));

vi.mock("../src/db/pool.js", () => pool);
vi.mock("../src/lib/leader.js", () => leader);
vi.mock("../src/modules/backups/backups.repository.js", () => repo);
vi.mock("../src/modules/backups/engine/runner.js", () => runner);
vi.mock("../src/modules/settings/settings.service.js", () => ({
  getBackupSettings: vi.fn().mockResolvedValue({ maxConcurrentDumps: 2 }),
}));
vi.mock("../src/modules/groups/group-runs.service.js", () => ({ settleGroupRuns: vi.fn() }));

import { enqueueExecution, startExecutionQueue } from "../src/modules/backups/engine/queue.js";

beforeEach(() => {
  vi.clearAllMocks();
  pool.query.mockResolvedValue({ rows: [] });
  leader.listenAsLeader.mockResolvedValue(undefined);
  repo.listQueuedExecutions.mockResolvedValue([]).mockResolvedValueOnce([{ id: "e1", serverId: "s1", method: "dump" }]);
  repo.findBusyServerIds.mockResolvedValue([]);
  runner.runExecution.mockResolvedValue(undefined);
});

// Orden importa: el módulo guarda si la cola ya arrancó (solo la líder la arranca).
describe("cola solo en la instancia líder", () => {
  it("en una seguidora no ejecuta nada: avisa a la líder por pg_notify", async () => {
    enqueueExecution();
    await vi.waitFor(() => expect(pool.query).toHaveBeenCalled());
    expect(pool.query).toHaveBeenCalledWith("SELECT pg_notify($1, '')", ["dbkeeper_queue"]);
    expect(repo.listQueuedExecutions).not.toHaveBeenCalled();
    expect(runner.runExecution).not.toHaveBeenCalled();
  });

  it("la líder escucha el canal y, al recibir el aviso, lanza la cola", async () => {
    startExecutionQueue();
    await vi.waitFor(() => expect(runner.runExecution).toHaveBeenCalledWith("e1"));
    expect(leader.listenAsLeader).toHaveBeenCalledWith("dbkeeper_queue", expect.any(Function));

    const onNotify = leader.listenAsLeader.mock.calls[0]![1] as () => void;
    repo.listQueuedExecutions.mockResolvedValueOnce([{ id: "e2", serverId: "s2", method: "dump" }]);
    onNotify();
    await vi.waitFor(() => expect(runner.runExecution).toHaveBeenCalledWith("e2"));
  });

  it("en la líder, enqueueExecution lanza la cola directamente (sin pg_notify)", async () => {
    repo.listQueuedExecutions.mockResolvedValueOnce([{ id: "e3", serverId: "s3", method: "dump" }]);
    enqueueExecution();
    await vi.waitFor(() => expect(runner.runExecution).toHaveBeenCalledWith("e3"));
    expect(pool.query).not.toHaveBeenCalled();
  });
});
