import type { AuthType, Role } from "./index.js";

/**
 * Catálogo de permisos del sistema (RBAC granular).
 * La clave sigue el patrón `recurso:acción`. Es el conjunto fijo de capacidades;
 * qué rol tiene cada permiso es configurable y editable (tablas auth.role_permissions).
 *
 * Algunos recursos pertenecen a etapas futuras (servers, backups, settings) pero se
 * declaran ya para sembrar los defaults por rol de una sola vez.
 */
export const PERMISSIONS = [
  // Usuarios
  { key: "users:read", category: "users", description: "Ver usuarios" },
  { key: "users:write", category: "users", description: "Crear y editar usuarios" },
  { key: "users:delete", category: "users", description: "Eliminar usuarios" },
  // Roles y permisos
  { key: "roles:read", category: "roles", description: "Ver roles y permisos" },
  { key: "roles:write", category: "roles", description: "Crear, editar roles y asignar permisos" },
  // Instancias / servidores (Etapa 2)
  { key: "servers:read", category: "servers", description: "Ver instancias y bases" },
  { key: "servers:write", category: "servers", description: "Crear y editar instancias" },
  { key: "servers:delete", category: "servers", description: "Eliminar instancias" },
  // Backups (Etapa 4+)
  { key: "backups:read", category: "backups", description: "Ver trabajos e historial de backups" },
  { key: "backups:run", category: "backups", description: "Ejecutar backups a demanda" },
  { key: "backups:schedule", category: "backups", description: "Programar backups" },
  // Configuración (Etapa 2)
  { key: "settings:read", category: "settings", description: "Ver configuración del sistema" },
  { key: "settings:write", category: "settings", description: "Modificar configuración del sistema" },
  // Auditoría
  { key: "audit:read", category: "audit", description: "Ver el registro de auditoría" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

/**
 * Permisos por defecto de cada rol base. Son la semilla inicial; el módulo de
 * Roles/Permisos permite modificarlos. `superadmin` siempre tiene todos.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<Role, PermissionKey[]> = {
  superadmin: ALL_PERMISSION_KEYS,
  admin: [
    "users:read",
    "users:write",
    "users:delete",
    "roles:read",
    "servers:read",
    "servers:write",
    "servers:delete",
    "backups:read",
    "backups:run",
    "backups:schedule",
    "settings:read",
    "settings:write",
    "audit:read",
  ],
  editor: [
    "servers:read",
    "servers:write",
    "backups:read",
    "backups:run",
    "backups:schedule",
    "settings:read",
  ],
  operator: ["servers:read", "backups:read", "backups:run"],
  viewer: ["users:read", "roles:read", "servers:read", "backups:read", "audit:read", "settings:read"],
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  superadmin: "Control total del sistema, incluida la gestión de roles y permisos.",
  admin: "Gestiona usuarios, instancias, backups y configuración.",
  editor: "Configura instancias y trabajos de backup; ejecuta y programa.",
  operator: "Ejecuta backups a demanda sobre instancias existentes.",
  viewer: "Acceso de solo lectura.",
};

/** Usuario tal como lo expone la API (sin password_hash). */
export interface UserDto {
  id: string;
  username: string;
  email: string | null;
  fullName: string | null;
  authType: AuthType;
  isActive: boolean;
  roles: string[]; // keys de rol
  avatar: string | null; // data URL de imagen pequeña
  preferredLanguage: string | null;
  preferredTheme: "dark" | "light" | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: PermissionKey[];
}

export interface PermissionDto {
  key: string;
  category: string;
  description: string;
}

/** Identidad autenticada que devuelve /api/auth/me. */
export interface AuthIdentity {
  user: UserDto;
  permissions: PermissionKey[];
}

export interface AuditEntryDto {
  id: string;
  userId: string | null;
  username: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  detail: unknown;
  createdAt: string;
}
