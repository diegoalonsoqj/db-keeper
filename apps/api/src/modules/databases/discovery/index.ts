import type { DbEngine } from "@dbkeeper/shared";
import type { Discoverer } from "./types.js";
import { discoverPostgres } from "./postgres.js";
import { discoverMysql } from "./mysql.js";
import { discoverSqlServer } from "./sqlserver.js";
import { discoverMongo } from "./mongo.js";

const DISCOVERERS: Record<DbEngine, Discoverer> = {
  postgres: discoverPostgres,
  mysql: discoverMysql,
  sqlserver: discoverSqlServer,
  mongo: discoverMongo,
};

export function getDiscoverer(engine: DbEngine): Discoverer {
  return DISCOVERERS[engine];
}

export type { ConnInfo } from "./types.js";
