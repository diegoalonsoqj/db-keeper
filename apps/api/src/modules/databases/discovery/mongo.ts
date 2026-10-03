import { MongoClient } from "mongodb";
import type { DiscoveredDatabase } from "@dbkeeper/shared";
import { buildMongoUri } from "../../../lib/mongo-uri.js";
import { DISCOVER_TIMEOUT_MS, type ConnInfo } from "./types.js";

const SYSTEM = new Set(["admin", "local", "config"]);

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
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const admin = client.db().admin();
    // Con tamaño (sizeOnDisk) si el usuario puede; si no, solo los nombres.
    let databases: { name: string; sizeOnDisk?: number }[];
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
