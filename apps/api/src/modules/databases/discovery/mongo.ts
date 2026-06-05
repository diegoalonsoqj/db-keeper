import { MongoClient } from "mongodb";
import { DISCOVER_TIMEOUT_MS, type ConnInfo } from "./types.js";

const SYSTEM = new Set(["admin", "local", "config"]);

export async function discoverMongo(conn: ConnInfo): Promise<string[]> {
  const auth = `${encodeURIComponent(conn.user)}:${encodeURIComponent(conn.password)}`;
  const uri =
    `mongodb://${auth}@${conn.host}:${conn.port}/?authSource=admin` +
    `&serverSelectionTimeoutMS=${DISCOVER_TIMEOUT_MS}&connectTimeoutMS=${DISCOVER_TIMEOUT_MS}` +
    (conn.ssl ? "&tls=true" : "");
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
