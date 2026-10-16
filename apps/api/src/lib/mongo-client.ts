import { MongoClient } from "mongodb";
// Driver 6.9: el último que habla con MongoDB 3.6/4.0 (wire 6–7); el 7.x exige 4.2+.
import { MongoClient as LegacyMongoClient } from "mongodb-v6";
import type { MongoCollectionInfo } from "@dbkeeper/shared";
import { isWireVersionTooLow } from "./mongo-compat.js";

type ListedDb = { name: string; sizeOnDisk?: number };

/** Lo mínimo que se usa de MongoClient, común a ambas versiones del driver. */
export interface MinimalMongoClient {
  connect(): Promise<unknown>;
  close(): Promise<void>;
  db(name?: string): {
    admin(): { listDatabases(opts?: { nameOnly?: boolean }): Promise<{ databases: ListedDb[] }> };
    listCollections(filter?: Record<string, unknown>): { toArray(): Promise<{ name: string; type?: string }[]> };
  };
}

/**
 * Abre un cliente con el driver actual y, si el servidor es anterior a 4.2 (wire
 * version), reintenta con el driver de respaldo. Cierra el cliente al terminar.
 */
export async function withMongoClient<T>(uri: string, fn: (client: MinimalMongoClient) => Promise<T>): Promise<T> {
  try {
    return await run(new MongoClient(uri), fn);
  } catch (err) {
    if (!isWireVersionTooLow(err)) throw err;
    return run(new LegacyMongoClient(uri), fn);
  }
}

async function run<T>(client: MinimalMongoClient, fn: (client: MinimalMongoClient) => Promise<T>): Promise<T> {
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.close();
  }
}

/**
 * Colecciones y vistas de una BD, sin las internas (`system.*`, que mongodump no
 * vuelca como datos). Sin `nameOnly` ni
 * `authorizedCollections`: MongoDB 3.6 no los admite.
 */
export async function listMongoCollections(client: MinimalMongoClient, dbName: string): Promise<MongoCollectionInfo[]> {
  const rows = await client.db(dbName).listCollections({}).toArray();
  return rows
    .filter((c) => !c.name.startsWith("system."))
    .map((c) => ({ name: c.name, type: c.type ?? "collection" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
