import type { PermissionDto } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";

export async function listPermissions(): Promise<PermissionDto[]> {
  const { rows } = await query<PermissionDto>(
    "SELECT key, category, description FROM auth.permissions ORDER BY category, key",
  );
  return rows;
}
