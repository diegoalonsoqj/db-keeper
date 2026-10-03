import { MongoClient } from "mongodb";
import { buildMongoUri } from "../../../lib/mongo-uri.js";
import { DISCOVER_TIMEOUT_MS, type ConnInfo } from "./types.js";

const SYSTEM = new Set(["admin", "local", "config"]);

export async function discoverMongo(conn: ConnInfo): Promise<string[]> {
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
    const { databases } = await client.db().admin().listDatabases({ nameOnly: true });
    return databases
      .map((d) => d.name)
      .filter((n) => !SYSTEM.has(n))
      .sort();
  } finally {
    await client.close();
  }
}
