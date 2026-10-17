-- Hilo de Telegram por corrida de grupo: el primer aviso de la corrida (inicio, aviso de
-- un evento o resumen) queda como raíz y el resto responde a él. Como en 0031, se guarda
-- el chat para no responder a un mensaje de otro chat si se cambia el destino.
ALTER TABLE core.group_runs
  ADD COLUMN telegram_chat_id text,
  ADD COLUMN telegram_message_id bigint;
