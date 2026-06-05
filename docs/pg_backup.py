#!/usr/bin/env python3
"""
Script para generar backups de PostgreSQL usando pg_dump
Configuración mediante archivo .env
Incluye validación de conexión y progreso en tiempo real
"""

import gzip
import os
import subprocess
import threading
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

# Configuración desde .env
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_NAME = os.getenv('DB_NAME', 'vidafree-db')
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')
BACKUP_DIR = os.getenv('BACKUP_DIR', './backups')
LOG_FILE = os.getenv('LOG_FILE', './backup.log')
BACKUP_TIMEOUT = int(os.getenv('BACKUP_TIMEOUT', '3600'))  # 1 hora por defecto
BACKUP_COMPRESS = os.getenv('BACKUP_COMPRESS', 'true').strip().lower() == 'true'
EXCLUDE_TABLES = [t.strip() for t in os.getenv('EXCLUDE_TABLES', '').split(',') if t.strip()]
AMBIENTE = os.getenv('AMBIENTE', '').strip().lower()
BACKUP_PROGRESS_INTERVAL = int(os.getenv('BACKUP_PROGRESS_INTERVAL', '30'))


def log_message(message, log_path):
    """Registra un mensaje en el archivo de log con formato [YYYY-MM-DD] - mensaje"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_entry = f"[{timestamp}] - {message}\n"
    
    # Crear directorio del log si no existe
    log_dir = Path(log_path).parent
    log_dir.mkdir(parents=True, exist_ok=True)
    
    # Escribir en el log
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(log_entry)
    
    # También imprimir en consola
    print(log_entry.strip())


def validate_credentials():
    """Valida que las credenciales estén configuradas"""
    if not DB_USER or not DB_PASSWORD:
        log_message("ERROR: DB_USER y DB_PASSWORD son requeridos en el archivo .env", LOG_FILE)
        return False
    return True


def validate_connection():
    """Valida la conexión a PostgreSQL antes del backup"""
    try:
        import psycopg2
    except ImportError:
        log_message(
            "ERROR: psycopg2 no está instalado. Instálalo con: pip install psycopg2-binary",
            LOG_FILE
        )
        return False
    
    try:
        log_message(f"Validando conexión a {DB_HOST}:{DB_PORT}/{DB_NAME}", LOG_FILE)
        
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            connect_timeout=10
        )
        
        # Obtener versión de PostgreSQL y tamaño de la BD
        cursor = conn.cursor()
        cursor.execute('SELECT version();')
        version = cursor.fetchone()[0]
        
        cursor.execute(f"""
            SELECT pg_size_pretty(pg_database_size('{DB_NAME}'));
        """)
        db_size = cursor.fetchone()[0]
        
        log_message(f"[OK] Conexion exitosa", LOG_FILE)
        log_message(f"  PostgreSQL: {version.split(',')[0]}", LOG_FILE)
        log_message(f"  Tamano de BD: {db_size}", LOG_FILE)
        
        cursor.close()
        conn.close()
        
        return True
        
    except Exception as e:
        error_msg = str(e).strip()
        log_message(f"ERROR: No se puede conectar a la base de datos", LOG_FILE)
        log_message(f"Detalles: {error_msg}", LOG_FILE)
        return False


def monitor_file_size(filepath, stop_event):
    """Monitorea el tamaño del archivo de backup en tiempo real"""
    import time
    last_size = 0
    
    while not stop_event.is_set():
        try:
            if filepath.exists():
                current_size = filepath.stat().st_size
                if current_size != last_size:
                    size_mb = current_size / (1024 * 1024)
                    log_message(f"  -> Progreso: {size_mb:.2f} MB escritos...", LOG_FILE)
                    last_size = current_size
            time.sleep(BACKUP_PROGRESS_INTERVAL)
        except Exception:
            pass


def validate_gz_backup(filepath):
    """Verifica integridad del .gz leyendo el stream completo (equivalente a gunzip -t)"""
    try:
        with gzip.open(filepath, 'rb') as f:
            while f.read(1024 * 1024):
                pass
        return True
    except Exception:
        return False


def create_backup():
    """Genera el backup de la base de datos PostgreSQL con progreso en tiempo real"""
    
    # Crear directorio de backups si no existe
    backup_path = Path(BACKUP_DIR)
    backup_path.mkdir(parents=True, exist_ok=True)
    
    # Generar nombre del archivo de backup con timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    ext = 'sql.gz' if BACKUP_COMPRESS else 'sql'
    env_suffix = f"_{AMBIENTE}" if AMBIENTE else ""
    backup_file = backup_path / f"backup_{DB_NAME}{env_suffix}_{timestamp}.{ext}"

    log_message(f"Iniciando backup de la base de datos '{DB_NAME}'", LOG_FILE)
    log_message(f"Timeout configurado: {BACKUP_TIMEOUT} segundos", LOG_FILE)
    
    # Configurar variable de entorno para la contraseña
    env = os.environ.copy()
    env['PGPASSWORD'] = DB_PASSWORD
    
    # Construir comando pg_dump con verbose
    cmd = [
        'pg_dump',
        '--verbose',  # Mostrar progreso
        '--serializable-deferrable',
        '--no-owner',
        '--no-privileges',
        '-h', DB_HOST,
        '-p', DB_PORT,
        '-U', DB_USER,
        '-d', DB_NAME
    ]

    # Agregar tablas excluidas desde variable de entorno
    for table in EXCLUDE_TABLES:
        cmd.extend(['--exclude-table', table])
        log_message(f"  Excluyendo tabla: {table}", LOG_FILE)
    
    try:
        log_message(f"Ejecutando pg_dump...", LOG_FILE)
        
        # Iniciar thread de monitoreo de tamaño
        stop_monitor = threading.Event()
        monitor_thread = threading.Thread(
            target=monitor_file_size,
            args=(backup_file, stop_monitor)
        )
        monitor_thread.daemon = True
        monitor_thread.start()
        
        # Ejecutar pg_dump con timeout
        opener = gzip.open if BACKUP_COMPRESS else open
        with opener(backup_file, 'wb') as f_out:
            process = subprocess.Popen(
                cmd,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            def _write_stdout():
                try:
                    while True:
                        chunk = process.stdout.read(65536)
                        if not chunk:
                            break
                        f_out.write(chunk)
                except Exception:
                    pass

            stdout_writer = threading.Thread(target=_write_stdout, daemon=True)
            stdout_writer.start()

            try:
                # Esperar con timeout
                stderr_output = []
                while True:
                    try:
                        stderr_line = process.stderr.readline()
                        if stderr_line:
                            line_str = stderr_line.decode('utf-8', errors='replace').strip()
                            stderr_output.append(line_str)
                            # Mostrar mensajes importantes de pg_dump
                            if any(keyword in line_str.lower() for keyword in ['error', 'fatal', 'warning']):
                                log_message(f"  pg_dump: {line_str}", LOG_FILE)

                        # Verificar si el proceso terminó
                        if process.poll() is not None:
                            break

                    except Exception:
                        break

                return_code = process.wait(timeout=BACKUP_TIMEOUT)
                stdout_writer.join(timeout=60)  # esperar flush completo antes de cerrar gzip

                if return_code != 0:
                    raise subprocess.CalledProcessError(
                        return_code,
                        cmd,
                        stderr='\n'.join(stderr_output)
                    )

            except subprocess.TimeoutExpired:
                log_message(f"ERROR: Timeout alcanzado ({BACKUP_TIMEOUT}s)", LOG_FILE)
                process.kill()
                stdout_writer.join(timeout=5)
                stop_monitor.set()
                if backup_file.exists():
                    backup_file.unlink()
                return False
        
        # Detener monitor
        stop_monitor.set()
        monitor_thread.join(timeout=1)
        
        # Verificar que el archivo se creó correctamente
        if backup_file.exists() and backup_file.stat().st_size > 0:
            file_size = backup_file.stat().st_size / (1024 * 1024)
            log_message(f"[OK] Backup completado exitosamente", LOG_FILE)
            log_message(f"  Archivo: {backup_file.name}", LOG_FILE)
            log_message(f"  Tamano: {file_size:.2f} MB", LOG_FILE)
            log_message(f"  Ruta: {backup_file.absolute()}", LOG_FILE)

            if BACKUP_COMPRESS:
                log_message(f"  Validando integridad del archivo comprimido...", LOG_FILE)
                if validate_gz_backup(backup_file):
                    log_message(f"[OK] Integridad verificada", LOG_FILE)
                else:
                    log_message(f"ERROR: Archivo corrupto, eliminando...", LOG_FILE)
                    backup_file.unlink()
                    return False
            return True
        else:
            log_message(f"ERROR: El archivo de backup esta vacio o no se creo", LOG_FILE)
            return False
            
    except subprocess.CalledProcessError as e:
        stop_monitor.set()
        log_message(f"ERROR al ejecutar pg_dump:", LOG_FILE)
        if e.stderr:
            for line in e.stderr.split('\n'):
                if line.strip():
                    log_message(f"  {line.strip()}", LOG_FILE)
        
        if backup_file.exists():
            backup_file.unlink()
            log_message(f"  Archivo de backup incompleto eliminado", LOG_FILE)
        return False
    
    except FileNotFoundError:
        log_message("ERROR: pg_dump no encontrado", LOG_FILE)
        return False
    
    except Exception as e:
        stop_monitor.set()
        log_message(f"ERROR inesperado: {str(e)}", LOG_FILE)
        if backup_file.exists():
            backup_file.unlink()
        return False


def main():
    """Función principal"""
    log_message("=" * 60, LOG_FILE)
    log_message("Iniciando proceso de backup", LOG_FILE)
    
    # 1. Validar credenciales
    if not validate_credentials():
        log_message("Proceso cancelado: credenciales faltantes", LOG_FILE)
        log_message("=" * 60, LOG_FILE)
        return 1
    
    # 2. Validar conexión
    if not validate_connection():
        log_message("Proceso cancelado: no hay conexion", LOG_FILE)
        log_message("=" * 60, LOG_FILE)
        return 1
    
    # 3. Crear backup
    success = create_backup()
    
    if success:
        log_message("[OK] Proceso finalizado exitosamente", LOG_FILE)
    else:
        log_message("[ERROR] Proceso finalizado con errores", LOG_FILE)
    
    log_message("=" * 60, LOG_FILE)
    
    return 0 if success else 1


if __name__ == "__main__":
    exit(main())