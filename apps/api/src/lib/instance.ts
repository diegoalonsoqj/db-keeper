import { hostname } from "node:os";

/** Host de este proceso: se guarda en cada ejecución y en application_name de las conexiones. */
export const INSTANCE_HOST = hostname();

/** application_name de las conexiones a la BD de metadatos (visible en pg_stat_activity). */
export const APPLICATION_NAME = `dbkeeper@${INSTANCE_HOST}`.slice(0, 63);
