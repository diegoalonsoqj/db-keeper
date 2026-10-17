-- Copia local de los eventos a bucket (keepLocalCopy): file_name guarda la URI gs://, así
-- que la copia en disco no quedaba registrada y la retención nunca la borraba. Se
-- registra aparte para poder purgarla sin tocar el objeto del bucket.
ALTER TABLE core.execution_items
  ADD COLUMN local_file_name text,
  ADD COLUMN local_pruned_at timestamptz;
