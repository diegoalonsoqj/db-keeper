-- Hilo de Telegram por ejecución: el primer aviso enviado (inicio o fin) queda como
-- raíz y los siguientes (fin, integridad días después) se envían como respuesta a él.
-- Se guarda el chat para no responder a un mensaje de otro chat si se cambia el destino.
ALTER TABLE core.executions
  ADD COLUMN telegram_chat_id text,
  ADD COLUMN telegram_message_id bigint;
