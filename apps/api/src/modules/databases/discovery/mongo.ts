import { MongoClient } from "mongodb";
import { DISCOVER_TIMEOUT_MS, type ConnInfo } from "./types.js";

const SYSTEM = new Set(["admin", "local", "config"]);

export async function discoverMongo(conn: ConnInfo): Promise<string[]> {
  const auth = `${encodeURIComponent(conn.user)}:${encodeURIComponent(conn.password)}`;
  const timeouts = `serverSelectionTimeoutMS=${DISCOVER_TIMEOUT_MS}&connectTimeoutMS=${DISCOVER_TIMEOUT_MS}`;
  // Atlas usa SRV (host .mongodb.net): sin puerto y con TLS, igual que el dumper.
  const isSrv = conn.host.endsWith(".mongodb.net");
  const uri = isSrv
    ? `mongodb+srv://${auth}@${conn.host}/?authSource=admin&tls=true&${timeouts}`
    : `mongodb://${auth}@${conn.host}:${conn.port}/?authSource=admin&${timeouts}` +
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
