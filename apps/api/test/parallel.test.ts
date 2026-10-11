import { describe, expect, it, vi } from "vitest";

// Los módulos del motor leen la config al importarse: valores mínimos de prueba.
vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

import { ALLOYDB_STDERR_IGNORE, mountPointError, suggestParallelJobs, isDirectoryArtifact } from "@dbkeeper/shared";
import { computeDiskSize } from "../src/modules/backups/engine/disk-size.js";
import { countTocEntries, filterRestoreList, isIgnoredLine } from "../src/modules/backups/engine/pg-parallel.js";
import { diffUploaded } from "../src/modules/backups/engine/gcs-dir.js";
import { scratchDiskName } from "../src/modules/backups/engine/scratch-disk.js";
import { selectRunnable } from "../src/modules/backups/engine/queue.js";
import { normalizeParallelOptions } from "../src/modules/backups/parallel-options.js";
import { siblingBinary } from "../src/lib/bin-path.js";
import path from "node:path";

const GB = 1024 ** 3;

describe("computeDiskSize", () => {
  const base = { override: null, defaultSizeGb: 1200, maxSizeGb: 2000, sizeMarginPct: 25, lastBytes: null };

  it("sin historial usa el tamaño por defecto", () => {
    expect(computeDiskSize(base)).toMatchObject({ sizeGb: 1200, warning: null });
  });

  it("con historial: último backup + margen, redondeado a 100 GB", () => {
    // 1000 GB × 1,25 = 1250 → 1300
    expect(computeDiskSize({ ...base, lastBytes: 1000 * GB }).sizeGb).toBe(1300);
  });

  it("nunca baja del tamaño por defecto", () => {
    expect(computeDiskSize({ ...base, lastBytes: 100 * GB }).sizeGb).toBe(1200);
  });

  it("se limita al máximo y avisa si el último backup ocupa más del 80 %", () => {
    const r = computeDiskSize({ ...base, lastBytes: 1900 * GB });
    expect(r.sizeGb).toBe(2000);
    expect(r.warning).toMatch(/95 %/);
  });

  it("el override del evento manda (acotado al máximo)", () => {
    expect(computeDiskSize({ ...base, override: 1500, lastBytes: 1000 * GB }).sizeGb).toBe(1500);
    expect(computeDiskSize({ ...base, override: 5000 }).sizeGb).toBe(2000);
  });

  it("caso real: 900 GB en el disco de 1024 GB del script dispara el aviso", () => {
    const r = computeDiskSize({ ...base, override: 1024, lastBytes: 900 * GB });
    expect(r.warning).not.toBeNull();
  });
});

describe("salida de pg_dump / pg_restore", () => {
  it("ignora el ruido de AlloyDB por texto literal", () => {
    expect(isIgnoredLine("pg_dump: warning: TopTransactionContext IS NOT NULL", ALLOYDB_STDERR_IGNORE)).toBe(true);
    expect(isIgnoredLine("pg_dump: error: connection failed", ALLOYDB_STDERR_IGNORE)).toBe(false);
    expect(isIgnoredLine("cualquier cosa", [""])).toBe(false);
  });

  const list = [
    ";",
    "; Archive created at 2026-10-11",
    "3; 2615 2200 SCHEMA - ventas postgres",
    "4501; 3466 16500 EVENT TRIGGER - trg_ddl postgres",
    "4502; 3466 16501 EVENT TRIGGER - trg_otro postgres",
    "5000; 0 16400 TABLE DATA ventas pedidos postgres",
  ].join("\n");

  it("cuenta solo las entradas reales del TOC", () => {
    expect(countTocEntries(list)).toBe(4);
  });

  it("comenta en restore.list solo los event triggers excluidos", () => {
    const r = filterRestoreList(list, ["trg_ddl", "no_existe"]);
    expect(r.skipped).toEqual(["trg_ddl"]);
    expect(r.text).toContain(";4501; 3466 16500 EVENT TRIGGER - trg_ddl postgres");
    expect(r.text).toContain("\n4502; 3466 16501 EVENT TRIGGER - trg_otro postgres");
  });
});

describe("diffUploaded", () => {
  const expected = [
    { name: "toc.dat", bytes: 10, crc32c: "AAA=" },
    { name: "3001.dat.gz", bytes: 20, crc32c: "BBB=" },
  ];

  it("vacío si todo coincide", () => {
    const actual = new Map([
      ["toc.dat", { bytes: 10, crc32c: "AAA=" }],
      ["3001.dat.gz", { bytes: 20, crc32c: "BBB=" }],
    ]);
    expect(diffUploaded(expected, actual)).toEqual([]);
  });

  it("detecta faltantes, tamaño y CRC32C distintos", () => {
    const actual = new Map([["toc.dat", { bytes: 11, crc32c: "AAA=" }]]);
    expect(diffUploaded(expected, actual)).toEqual([
      "toc.dat: 11 bytes en el bucket, 10 locales",
      "3001.dat.gz: no está en el bucket",
    ]);
    const crc = new Map([
      ["toc.dat", { bytes: 10, crc32c: "ZZZ=" }],
      ["3001.dat.gz", { bytes: 20, crc32c: "BBB=" }],
    ]);
    expect(diffUploaded(expected, crc)[0]).toMatch(/CRC32C/);
  });
});

describe("disco temporal", () => {
  it("el nombre cumple el patrón que exige el helper root", () => {
    const n = scratchDiskName("3F2504E0-4F89-11D3-9A0C-0305E82C3301");
    expect(n).toBe("dbk-scratch-3f2504e04f8911d3");
    expect(n).toMatch(/^dbk-scratch-[a-z0-9-]{1,40}$/);
  });

  it("valida el punto de montaje", () => {
    expect(mountPointError("/backup-alloydb")).toBeNull();
    expect(mountPointError("/")).not.toBeNull();
    expect(mountPointError("/etc")).not.toBeNull();
    expect(mountPointError("/var/lib/x")).not.toBeNull();
    expect(mountPointError("/backup/../etc")).not.toBeNull();
    expect(mountPointError("relativa")).not.toBeNull();
    expect(mountPointError("/con espacio")).not.toBeNull();
  });

  it("workers sugeridos: vCPU - 2, entre 1 y 14", () => {
    expect(suggestParallelJobs(16)).toBe(14);
    expect(suggestParallelJobs(32)).toBe(14);
    expect(suggestParallelJobs(8)).toBe(6);
    expect(suggestParallelJobs(2)).toBe(1);
  });

  it("reconoce un backup en carpeta por la barra final", () => {
    expect(isDirectoryArtifact("gs://b/x/db_20261011/")).toBe(true);
    expect(isDirectoryArtifact("gs://b/x/db.sql.gz")).toBe(false);
    expect(isDirectoryArtifact(null)).toBe(false);
  });
});

describe("normalizeParallelOptions", () => {
  const ctx = { vcpus: 16, maxSizeGb: 2000, dumpMaxHours: 24, isAlloyDb: true };

  it("aplica defaults: -j sugerido, permisos conservados y ruido de AlloyDB", () => {
    const o = normalizeParallelOptions({ compress: true, pgCompat: true }, "pg_parallel", ctx);
    expect(o).toMatchObject({
      parallelJobs: 14,
      noPrivileges: false,
      diskSizeGb: null,
      diskType: null,
      maxHours: 12,
      stderrIgnore: ALLOYDB_STDERR_IGNORE,
      compress: true,
    });
    expect(o).not.toHaveProperty("pgCompat");
  });

  it("respeta lo enviado y depura el filtro de ruido", () => {
    const o = normalizeParallelOptions(
      { parallelJobs: 8, noPrivileges: true, diskSizeGb: 1500, diskType: "pd-balanced", maxHours: 20, stderrIgnore: [" a ", "a", ""] },
      "pg_parallel",
      ctx,
    );
    expect(o).toMatchObject({ parallelJobs: 8, noPrivileges: true, diskSizeGb: 1500, diskType: "pd-balanced", maxHours: 20, stderrIgnore: ["a"] });
  });

  it("rechaza valores fuera de rango", () => {
    expect(() => normalizeParallelOptions({ parallelJobs: 0 }, "pg_parallel", ctx)).toThrow(/parallelJobs/);
    expect(() => normalizeParallelOptions({ diskSizeGb: 3000 }, "pg_parallel", ctx)).toThrow(/diskSizeGb/);
    expect(() => normalizeParallelOptions({ maxHours: 30 }, "pg_parallel", ctx)).toThrow(/maxHours/);
    expect(() => normalizeParallelOptions({ diskType: "pd-standard" }, "pg_parallel", ctx)).toThrow(/diskType/);
  });

  it("con otro método quita las claves del dump paralelo", () => {
    const o = normalizeParallelOptions({ parallelJobs: 8, compress: true }, "gcloud", ctx);
    expect(o).toEqual({ compress: true });
  });
});

describe("cola: dump paralelo", () => {
  const q = (id: string, serverId: string, method: string) => ({ id, serverId, method });

  it("solo uno a la vez (punto de montaje único), aunque haya huecos y sean instancias distintas", () => {
    const out = selectRunnable([q("a", "s1", "pg_parallel"), q("b", "s2", "pg_parallel"), q("c", "s3", "dump")], [], new Map(), 5);
    expect(out.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("espera si ya hay uno en curso", () => {
    const running = new Map([["x", { serverId: "s9", dump: true, scratch: true }]]);
    expect(selectRunnable([q("a", "s1", "pg_parallel")], [], running, 5)).toEqual([]);
  });
});

describe("siblingBinary", () => {
  it("toma pg_restore de la misma carpeta que pg_dump", () => {
    const dump = "/usr/lib/postgresql/18/bin/pg_dump";
    expect(siblingBinary(dump, "pg_restore")).toBe(path.join(path.dirname(dump), "pg_restore"));
  });

  it("conserva la extensión .exe en Windows", () => {
    const dump = "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe";
    expect(siblingBinary(dump, "pg_restore")).toBe(path.join(path.dirname(dump), "pg_restore.exe"));
  });

  it("si pg_dump está en el PATH, usa pg_restore del PATH", () => {
    expect(siblingBinary("pg_dump", "pg_restore")).toBe("pg_restore");
  });
});
