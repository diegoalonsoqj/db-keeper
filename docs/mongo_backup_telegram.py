import os
import subprocess
import time
from datetime import datetime
import logging
from dotenv import load_dotenv
import requests

# ==================================================
# Cargar variables de entorno
# ==================================================
load_dotenv()

MONGO_USER = os.getenv("MONGO_USER")
MONGO_PASSWORD = os.getenv("MONGO_PASSWORD")
MONGO_CLUSTER = os.getenv("MONGO_CLUSTER")
MONGO_DB = os.getenv("MONGO_DB")
BACKUP_DIR = os.getenv("BACKUP_DIR")

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

GCS_BUCKET_PATH = os.getenv("GCS_BUCKET_PATH")
UPLOAD_TO_GCS = os.getenv("UPLOAD_TO_GCS", "true").strip().lower() == "true"

MAX_RETRIES = int(os.getenv("MAX_RETRIES", 3))
RETRY_WAIT = int(os.getenv("RETRY_WAIT", 60))

# ==================================================
# Validación de variables obligatorias
# ==================================================
REQUIRED_ENV = [
    "MONGO_USER",
    "MONGO_PASSWORD",
    "MONGO_CLUSTER",
    "MONGO_DB",
    "BACKUP_DIR",
]

if UPLOAD_TO_GCS:
    REQUIRED_ENV.append("GCS_BUCKET_PATH")

for var in REQUIRED_ENV:
    if not os.getenv(var):
        raise RuntimeError(f"❌ Variable de entorno faltante: {var}")

# ==================================================
# Paths y timestamps (fecha actual)
# ==================================================
now = datetime.now()
timestamp = now.strftime("%Y%m%d%H%M%S")
date_folder = now.strftime("%Y%m%d")

compressed_file = f"{MONGO_DB}-{timestamp}.gz"
compressed_path = os.path.join(BACKUP_DIR, compressed_file)

log_file = os.path.join(BACKUP_DIR, f"backup-{timestamp}.log")

os.makedirs(BACKUP_DIR, exist_ok=True)

# ==================================================
# Logging
# ==================================================
logging.basicConfig(
    filename=log_file,
    encoding="utf-8",
    level=logging.INFO,
    format="%(asctime)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

def log_event(msg):
    print(msg)
    logging.info(msg)

# ==================================================
# Telegram
# ==================================================
def send_telegram_message(msg):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
            data={"chat_id": TELEGRAM_CHAT_ID, "text": msg},
            timeout=10
        )
    except Exception as e:
        logging.error(f"Telegram error: {e}")

# ==================================================
# Test conexión MongoDB
# ==================================================
def test_connection():
    try:
        result = subprocess.run(
            [
                "mongosh",
                f"mongodb+srv://{MONGO_USER}:{MONGO_PASSWORD}@{MONGO_CLUSTER}/admin",
                "--eval",
                "db.runCommand({ ping: 1 })"
            ],
            capture_output=True,
            text=True,
            timeout=15
        )
        return result.returncode == 0
    except Exception as e:
        log_event(f"❌ Error conexión mongosh: {e}")
        return False

# ==================================================
# Backup MongoDB Atlas
# ==================================================
def run_backup():
    uri = (
        f"mongodb+srv://{MONGO_USER}:{MONGO_PASSWORD}"
        f"@{MONGO_CLUSTER}/{MONGO_DB}"
        f"?retryWrites=true&w=majority&tls=true"
        f"&readPreference=secondaryPreferred"
    )

    for attempt in range(1, MAX_RETRIES + 1):
        log_event(f"📦 mongodump intento {attempt}/{MAX_RETRIES}")
        try:
            subprocess.run(
                [
                    "mongodump",
                    f"--uri={uri}",
                    f"--archive={compressed_path}",
                    "--gzip",
                    "--verbose"
                ],
                capture_output=True,
                text=True,
                check=True
            )
            return True
        except subprocess.CalledProcessError as e:
            stderr = e.stderr.lower()
            log_event("❌ Error en mongodump")
            log_event(e.stderr.strip())

            if "shutdowninprogress" in stderr or "quiesce mode" in stderr:
                log_event("⚠️ Nodo en mantenimiento Atlas. Reintentando...")
                time.sleep(RETRY_WAIT)
                continue
            return False
    return False

# ==================================================
# GCS helpers
# ==================================================
def gcs_object_exists(path):
    try:
        result = subprocess.run(
            ["gcloud", "storage", "ls", path],
            capture_output=True,
            text=True,
            timeout=60
        )
        return result.returncode == 0
    except Exception:
        return False

def upload_to_gcs(local_path):
    destination = f"{GCS_BUCKET_PATH}/{date_folder}/"
    remote_path = f"{destination}{os.path.basename(local_path)}"

    log_event(f"☁️ Subiendo a GCS: {remote_path}")
    send_telegram_message(f"☁️ Subiendo a GCS\n{os.path.basename(local_path)}")

    try:
        subprocess.run(
            ["gcloud", "storage", "cp", local_path, destination],
            capture_output=True,
            text=True,
            timeout=900,
            check=True
        )

        log_event("🔎 Validando existencia en GCS...")
        return gcs_object_exists(remote_path)

    except subprocess.CalledProcessError as e:
        log_event("❌ Error al subir a GCS")
        log_event(e.stderr.strip())
        return False

# ==================================================
# Flujo principal
# ==================================================
start_time = datetime.now()
status = "FAILED"

log_event("🔄 Iniciando backup MongoDB Atlas")
send_telegram_message("🔄 Iniciando backup MongoDB Atlas")

if test_connection() and run_backup():
    log_event("✅ Backup generado correctamente")
    send_telegram_message("📦 Backup MongoDB generado")

    if UPLOAD_TO_GCS:
        backup_ok = upload_to_gcs(compressed_path)
        log_ok = upload_to_gcs(log_file)

        if backup_ok and log_ok:
            os.remove(compressed_path)
            log_event("🗑️ Backup local eliminado (backup + log confirmados en GCS)")
            send_telegram_message("🗑️ Backup local eliminado correctamente")
            status = "OK"
        else:
            log_event("❌ No se eliminaron archivos locales (fallo validación GCS)")
            send_telegram_message("❌ Error validando backup o log en GCS")
    else:
        log_event(f"💾 Backup guardado localmente (subida a GCS desactivada): {compressed_path}")
        send_telegram_message(f"💾 Backup guardado localmente (GCS desactivado)\n{compressed_file}")
        status = "OK"
else:
    log_event("❌ Backup MongoDB fallido")
    send_telegram_message("❌ Backup MongoDB fallido")

# ==================================================
# Cierre
# ==================================================
duration = str(datetime.now() - start_time).split(".")[0]
log_event(f"🏁 Proceso finalizado. Estado: {status}. Duración: {duration}")
send_telegram_message(
    f"🏁 Backup MongoDB finalizado\nEstado: {status}\nDuración: {duration}"
)
