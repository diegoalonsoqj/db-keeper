-- Host del proceso que corrió la ejecución (os.hostname()). Si por error dos instancias
-- de DBKeeper comparten esta BD, deja claro cuál ejecutó cada backup. NULL en las
-- anteriores a esta migración y en las canceladas antes de salir de la cola.
ALTER TABLE core.executions ADD COLUMN runner_host text;
