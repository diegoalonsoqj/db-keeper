#!/usr/bin/env python3
"""
Script para realizar backups de MySQL usando mysqldump
Utiliza variables de entorno para configuración sensible
"""

import os
import subprocess
import sys
import logging
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

# Cargar variables de entorno desde archivo .env
load_dotenv()


def setup_logging(log_dir):
    """
    Configura el sistema de logging
    
    Args:
        log_dir: Directorio donde se guardarán los logs
    """
    # Crear directorio de logs si no existe
    Path(log_dir).mkdir(parents=True, exist_ok=True)
    
    # Generar nombre del archivo de log con timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = os.path.join(log_dir, f"mysql_backup_{timestamp}.log")
    
    # Configurar logging con encoding UTF-8 para soportar símbolos en Windows
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file, encoding='utf-8'),
            logging.StreamHandler(sys.stdout)
        ]
    )
    
    # Configurar el StreamHandler para usar UTF-8 en Windows
    if sys.platform == 'win32':
        for handler in logging.getLogger().handlers:
            if isinstance(handler, logging.StreamHandler) and handler.stream == sys.stdout:
                handler.stream.reconfigure(encoding='utf-8')
    
    return log_file


def get_env_variable(var_name, required=True, default=None):
    """
    Obtiene una variable de entorno
    
    Args:
        var_name: Nombre de la variable
        required: Si es requerida o no
        default: Valor por defecto si no es requerida
    """
    value = os.getenv(var_name, default)
    if required and not value:
        logging.error(f"La variable de entorno {var_name} es requerida")
        sys.exit(1)
    return value


def check_mysqldump_available():
    """Verifica si mysqldump está disponible en el sistema"""
    try:
        result = subprocess.run(
            ["mysqldump", "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        if result.returncode == 0:
            logging.info(f"mysqldump encontrado: {result.stdout.strip()}")
            return True
        return False
    except FileNotFoundError:
        logging.error("ERROR: mysqldump no está instalado o no está en el PATH")
        logging.error("")
        logging.error("Soluciones:")
        if sys.platform == 'win32':
            logging.error("  Windows:")
            logging.error("  1. Descarga MySQL desde: https://dev.mysql.com/downloads/mysql/")
            logging.error("  2. Instala MySQL o solo las herramientas cliente")
            logging.error("  3. Agrega al PATH: C:\\Program Files\\MySQL\\MySQL Server X.X\\bin")
            logging.error("     O especifica la ruta completa en MYSQLDUMP_PATH en el .env")
        else:
            logging.error("  Linux/Mac:")
            logging.error("  Ubuntu/Debian: sudo apt-get install mysql-client")
            logging.error("  macOS: brew install mysql-client")
            logging.error("  CentOS/RHEL: sudo yum install mysql")
        return False


def test_mysql_connection(host, port, user, password, database, mysql_path="mysql"):
    """
    Prueba la conexión a MySQL antes de hacer el backup
    
    Args:
        host: Host de MySQL
        port: Puerto de MySQL
        user: Usuario de MySQL
        password: Contraseña de MySQL
        database: Nombre de la base de datos
        mysql_path: Ruta al cliente mysql
    
    Returns:
        bool: True si la conexión fue exitosa, False en caso contrario
    """
    logging.info("=" * 60)
    logging.info("PROBANDO CONEXIÓN A MYSQL")
    logging.info("=" * 60)
    logging.info(f"Servidor: {host}:{port}")
    logging.info(f"Base de datos: {database}")
    logging.info(f"Usuario: {user}")
    
    # Construir comando para probar conexión
    # Usamos una consulta simple que no modifica datos
    cmd = [
        mysql_path,
        f"--host={host}",
        f"--port={port}",
        f"--user={user}",
        f"--password={password}",
        database,
        "-e", "SELECT VERSION(), DATABASE(), USER();"
    ]
    
    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
            timeout=10  # Timeout de 10 segundos
        )
        
        logging.info("[OK] Conexión exitosa a MySQL")
        
        # Mostrar información de la conexión
        output_lines = result.stdout.strip().split('\n')
        if len(output_lines) > 1:
            # La primera línea son los headers, la segunda los valores
            logging.info(f"Información del servidor:")
            for line in output_lines[1:]:
                logging.info(f"  {line}")
        
        logging.info("=" * 60)
        return True
        
    except subprocess.TimeoutExpired:
        logging.error("[ERROR] Timeout al intentar conectar a MySQL")
        logging.error(f"El servidor {host}:{port} no responde")
        logging.error("Verifica:")
        logging.error("  - Que el servidor MySQL esté corriendo")
        logging.error("  - Que el host y puerto sean correctos")
        logging.error("  - Que no haya firewall bloqueando la conexión")
        logging.info("=" * 60)
        return False
        
    except subprocess.CalledProcessError as e:
        logging.error("[ERROR] No se pudo conectar a MySQL")
        error_msg = e.stderr.strip()
        
        # Analizar errores comunes
        if "Access denied" in error_msg:
            logging.error("Credenciales incorrectas")
            logging.error("Verifica el usuario y contraseña en el archivo .env")
        elif "Unknown database" in error_msg:
            logging.error(f"La base de datos '{database}' no existe")
            logging.error("Verifica el nombre de la base de datos en el archivo .env")
        elif "Can't connect" in error_msg or "Connection refused" in error_msg:
            logging.error(f"No se puede conectar al servidor {host}:{port}")
            logging.error("Verifica:")
            logging.error("  - Que el servidor MySQL esté corriendo")
            logging.error("  - Que el host y puerto sean correctos")
            logging.error("  - Que el firewall permita conexiones al puerto 3306")
        else:
            logging.error(f"Error: {error_msg}")
        
        logging.info("=" * 60)
        return False
        
    except FileNotFoundError:
        logging.error(f"[ERROR] No se encuentra el comando: {mysql_path}")
        logging.error("Verifica que el cliente MySQL esté instalado")
        logging.info("=" * 60)
        return False
        
    except Exception as e:
        logging.error(f"[ERROR] Error inesperado al probar conexión: {str(e)}")
        logging.info("=" * 60)
        return False


def create_backup_directory(backup_dir):
    """Crea el directorio de backup si no existe"""
    Path(backup_dir).mkdir(parents=True, exist_ok=True)
    logging.info(f"Directorio de backup: {backup_dir}")


def generate_backup_filename(database_name, backup_dir):
    """Genera el nombre del archivo de backup con timestamp"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{database_name}_backup_{timestamp}.sql"
    return os.path.join(backup_dir, filename)


def mysqldump_backup(host, port, user, password, database, output_file, mysqldump_path="mysqldump"):
    """
    Ejecuta mysqldump para crear el backup
    
    Args:
        host: Host de MySQL
        port: Puerto de MySQL
        user: Usuario de MySQL
        password: Contraseña de MySQL
        database: Nombre de la base de datos
        output_file: Ruta del archivo de salida
        mysqldump_path: Ruta al ejecutable mysqldump (default: "mysqldump")
    """
    logging.info("=" * 60)
    logging.info(f"Iniciando backup de la base de datos: {database}")
    logging.info(f"Servidor: {host}:{port}")
    logging.info(f"Usuario: {user}")
    logging.info(f"Archivo de salida: {output_file}")
    logging.info("=" * 60)
    
    # Construir el comando mysqldump
    cmd = [
        mysqldump_path,
        f"--host={host}",
        f"--port={port}",
        f"--user={user}",
        f"--password={password}",
        "--single-transaction",
        "--quick",
        "--routines",
        "--triggers",
        "--events",
        "--hex-blob",
        "--set-gtid-purged=OFF",
        database
    ]
    
    try:
        # Ejecutar mysqldump y redirigir salida al archivo
        logging.info("Ejecutando mysqldump...")
        with open(output_file, 'w', encoding='utf-8') as f:
            result = subprocess.run(
                cmd,
                stdout=f,
                stderr=subprocess.PIPE,
                text=True,
                check=True
            )
        
        # Verificar que el archivo se creó correctamente
        file_size = os.path.getsize(output_file)
        logging.info(f"[OK] Backup completado exitosamente")
        logging.info(f"Tamaño del archivo: {file_size / (1024*1024):.2f} MB")
        
        return True
        
    except subprocess.CalledProcessError as e:
        logging.error("[ERROR] Error al ejecutar mysqldump:")
        logging.error(e.stderr)
        # Eliminar archivo parcial si existe
        if os.path.exists(output_file):
            os.remove(output_file)
            logging.info(f"Archivo parcial eliminado: {output_file}")
        return False
    except FileNotFoundError:
        logging.error(f"[ERROR] No se encuentra el comando: {mysqldump_path}")
        logging.error("Verifica que mysqldump esté instalado y en el PATH")
        return False
    except Exception as e:
        logging.error(f"[ERROR] Error inesperado: {str(e)}")
        if os.path.exists(output_file):
            os.remove(output_file)
            logging.info(f"Archivo parcial eliminado: {output_file}")
        return False


def clean_definers(sql_file):
    """
    Elimina las cláusulas DEFINER del archivo SQL para compatibilidad con Cloud SQL.
    Reemplaza patrones como:
      DEFINER=`user`@`host`
      DEFINER = `user`@`%`
    """
    logging.info("Limpiando cláusulas DEFINER del backup...")
    
    try:
        import re
        
        temp_file = f"{sql_file}.tmp"
        definer_pattern = re.compile(r'\s*DEFINER\s*=\s*\S+', re.IGNORECASE)
        lines_cleaned = 0
        
        with open(sql_file, 'r', encoding='utf-8') as infile, \
             open(temp_file, 'w', encoding='utf-8') as outfile:
            for line in infile:
                new_line = definer_pattern.sub('', line)
                if new_line != line:
                    lines_cleaned += 1
                outfile.write(new_line)
        
        # Reemplazar archivo original con el limpio
        os.replace(temp_file, sql_file)
        
        logging.info(f"[OK] DEFINER eliminado en {lines_cleaned} líneas")
        return True
        
    except Exception as e:
        logging.error(f"[ERROR] Error al limpiar DEFINER: {str(e)}")
        # Limpiar archivo temporal si quedó
        if os.path.exists(temp_file):
            os.remove(temp_file)
        return False


def compress_backup(sql_file):
    """Comprime el archivo SQL usando gzip"""
    logging.info("Comprimiendo backup...")
    
    try:
        gzip_file = f"{sql_file}.gz"
        subprocess.run(
            ["gzip", "-f", sql_file],
            check=True,
            stderr=subprocess.PIPE
        )
        
        if os.path.exists(gzip_file):
            file_size = os.path.getsize(gzip_file)
            logging.info(f"[OK] Archivo comprimido: {gzip_file}")
            logging.info(f"Tamaño comprimido: {file_size / (1024*1024):.2f} MB")
            return True
        else:
            logging.error("[ERROR] No se pudo crear el archivo comprimido")
            return False
            
    except subprocess.CalledProcessError as e:
        logging.error(f"[ERROR] Error al comprimir: {e.stderr.decode()}")
        return False
    except Exception as e:
        logging.error(f"[ERROR] Error inesperado al comprimir: {str(e)}")
        return False


def main():
    """Función principal"""
    
    # Leer variables de entorno para logging
    log_dir = get_env_variable("LOG_DIR", required=False, default="./logs")
    
    # Configurar logging
    log_file = setup_logging(log_dir)
    
    logging.info("=" * 60)
    logging.info("SCRIPT DE BACKUP MYSQL")
    logging.info("=" * 60)
    logging.info(f"Archivo de log: {log_file}")
    
    # Verificar que mysqldump esté disponible
    mysqldump_path = get_env_variable("MYSQLDUMP_PATH", required=False, default="mysqldump")
    mysql_path = get_env_variable("MYSQL_PATH", required=False, default="mysql")
    
    if not check_mysqldump_available():
        logging.error("=" * 60)
        logging.error("PROCESO CANCELADO: mysqldump no disponible")
        logging.error("=" * 60)
        sys.exit(1)
    
    # Leer variables de entorno
    mysql_host = get_env_variable("MYSQL_HOST", default="localhost")
    mysql_port = get_env_variable("MYSQL_PORT", default="3306")
    mysql_user = get_env_variable("MYSQL_USER")
    mysql_password = get_env_variable("MYSQL_PASSWORD")
    mysql_database = get_env_variable("MYSQL_DATABASE")
    backup_dir = get_env_variable("BACKUP_DIR", default="./backups")
    compress = get_env_variable("COMPRESS_BACKUP", default="true").lower() == "true"
    clean_def = get_env_variable("CLEAN_DEFINERS", required=False, default="true").lower() == "true"
    
    # Probar conexión antes de continuar
    connection_ok = test_mysql_connection(
        mysql_host,
        mysql_port,
        mysql_user,
        mysql_password,
        mysql_database,
        mysql_path
    )
    
    if not connection_ok:
        logging.error("=" * 60)
        logging.error("PROCESO CANCELADO: No se pudo conectar a MySQL")
        logging.error("=" * 60)
        sys.exit(1)
    
    # Crear directorio de backup
    create_backup_directory(backup_dir)
    
    # Generar nombre del archivo
    output_file = generate_backup_filename(mysql_database, backup_dir)
    
    # Realizar backup
    success = mysqldump_backup(
        mysql_host,
        mysql_port,
        mysql_user,
        mysql_password,
        mysql_database,
        output_file,
        mysqldump_path
    )
    
    if not success:
        logging.error("[ERROR] El backup falló")
        logging.info("=" * 60)
        logging.info("PROCESO FINALIZADO CON ERRORES")
        logging.info("=" * 60)
        sys.exit(1)
    
    # Limpiar DEFINER para compatibilidad con Cloud SQL (GCP)
    if clean_def:
        clean_success = clean_definers(output_file)
        if not clean_success:
            logging.warning("Advertencia: El backup se completó pero la limpieza de DEFINER falló")
    
    # Comprimir si está habilitado
    if compress:
        compress_success = compress_backup(output_file)
        if not compress_success:
            logging.warning("Advertencia: El backup se completó pero la compresión falló")
    
    logging.info("=" * 60)
    logging.info("PROCESO COMPLETADO EXITOSAMENTE")
    logging.info(f"Log guardado en: {log_file}")
    logging.info("=" * 60)


if __name__ == "__main__":
    main()