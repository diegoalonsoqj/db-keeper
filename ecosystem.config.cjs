// Configuración de PM2 para DBKeeper (API que además sirve el front en un solo puerto).
// Uso: desde la raíz del repo  ->  pm2 start ecosystem.config.cjs
//
// Corre Node directo sobre el build (apps/api/dist/index.js) con cwd en apps/api,
// para que las rutas relativas (../../.env, ../web/dist, ../../backups) resuelvan igual
// que con `pnpm --filter @dbkeeper/api start`. No usa pnpm como wrapper a propósito:
// así PM2 supervisa el proceso Node real y propaga bien las señales de reinicio.
module.exports = {
  apps: [
    {
      name: "db-keeper",
      script: "dist/index.js",
      cwd: "./apps/api",
      // --env-file-if-exists carga el .env de la raíz (relativo a cwd = apps/api).
      node_args: "--env-file-if-exists=../../.env",
      exec_mode: "fork",
      instances: 1, // el motor/scheduler corre in-proceso: una sola instancia.
      autorestart: true,
      max_restarts: 10,
      // Al superarlo PM2 reinicia y mata los backups en curso: holgado a propósito.
      max_memory_restart: "2G",
      // Logs con timestamp (PM2 los guarda en ~/.pm2/logs por defecto).
      time: true,
    },
  ],
};
