import { MongoClient } from "mongodb";
// Driver 6.9: el último que habla con MongoDB 3.6/4.0 (wire 6–7); el 7.x exige 4.2+.
import { MongoClient as LegacyMongoClient } from "mongodb-v6";
import type { DiscoveredDatabase } from "@dbkeeper/shared";
import { buildMongoUri } from "../../../lib/mongo-uri.js";
import { DISCOVER_TIMEOUT_MS, type ConnInfo } from "./types.js";

const SYSTEM = new Set(["admin", "local", "config"]);

/**
 * Servidor más viejo de lo que soporta el driver actual. El driver lo informa en el
 * handshake o en la selección de servidor, con dos redacciones distintas.
 */
const WIRE_VERSION_RE = /wire version \d+, but this version of the (Node\.js )?driver requires at least/i;

export function isWireVersionTooLow(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return WIRE_VERSION_RE.test(err.message) || (err.cause instanceof Error && WIRE_VERSION_RE.test(err.cause.message));
}

type ListedDb = { name: string; sizeOnDisk?: number };

/** Lo mínimo que se usa de MongoClient, común a ambas versiones del driver. */
interface MinimalClient {
  connect(): Promise<unknown>;
  close(): Promise<void>;
  db(): { admin(): { listDatabases(opts?: { nameOnly?: boolean }): Promise<{ databases: ListedDb[] }> } };
}

export async function discoverMongo(conn: ConnInfo): Promise<DiscoveredDatabase[]> {
  // Misma URI que el dump (SRV y opciones de la instancia), más timeouts cortos.
  const uri = buildMongoUri({
    ...conn,
    srv: conn.mongoSrv === true || conn.host.endsWith(".mongodb.net"),
    options: conn.connOptions,
    extra: {
      serverSelectionTimeoutMS: String(DISCOVER_TIMEOUT_MS),
      connectTimeoutMS: String(DISCOVER_TIMEOUT_MS),
    },
  });
  try {
    return await listWith(new MongoClient(uri));
  } catch (err) {
    if (!isWireVersionTooLow(err)) throw err;
    return listWith(new LegacyMongoClient(uri));
  }
}

async function listWith(client: MinimalClient): Promise<DiscoveredDatabase[]> {
  try {
    await client.connect();
    const admin = client.db().admin();
    // Con tamaño (sizeOnDisk) si el usuario puede; si no, solo los nombres.
    let databases: ListedDb[];
    try {
      databases = (await admin.listDatabases()).databases;
    } catch {
      databases = (await admin.listDatabases({ nameOnly: true })).databases;
    }
    return databases
      .filter((d) => !SYSTEM.has(d.name))
      .map((d) => ({ name: d.name, bytes: typeof d.sizeOnDisk === "number" ? d.sizeOnDisk : null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await client.close();
  }
}
