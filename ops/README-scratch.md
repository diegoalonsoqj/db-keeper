# Disco temporal del dump paralelo (AlloyDB)

El método **Dump paralelo (directorio)** (`pg_parallel`) crea en cada ejecución un disco
**nuevo** en la VM donde corre DBKeeper, lo formatea y monta en `/backup-alloydb`, corre
`pg_dump -Fd -j N`, sube cada carpeta al bucket (verificada con `manifest.json`) y al final
desmonta, desadjunta y borra el disco. Diseño completo: `docs/ALLOYDB-BACKUP-DESIGN.txt`.

DBKeeper corre sin privilegios. Lo único que se ejecuta como root es
`ops/dbkeeper-scratch.sh` (formatear y montar/desmontar), vía una regla de sudoers que
solo permite ese binario. Crear/adjuntar/borrar el disco usa la API de Compute Engine.

Requisitos: VM de Compute Engine (Linux), `pg_dump`/`pg_restore` de versión igual o mayor
que el servidor (AlloyDB 14 → sirve el cliente 18), un bucket de GCP en Almacenamiento.

## 1. Herramientas en la VM

```bash
# Ubuntu minimal: mkfs.ext4, blkid/lsblk/findmnt/mount (util-linux) y udevadm
sudo apt-get update && sudo apt-get install -y e2fsprogs util-linux udev
# Cliente PostgreSQL (pg_dump + pg_restore); ajusta PG_DUMP_PATH/PG_RESTORE_PATH si no están en el PATH
pg_dump --version && pg_restore --version
```

## 2. Helper root

```bash
cd /apps/db-keeper   # raíz del repo en la VM
sudo install -o root -g root -m 0755 ops/dbkeeper-scratch.sh /usr/local/sbin/dbkeeper-scratch
```

Por defecto solo permite montar en `/backup-alloydb`. Para otra ruta (debe coincidir con
Configuración → Disco temporal → Punto de montaje):

```bash
echo 'ALLOWED_MOUNTS="/backup-alloydb"' | sudo tee /etc/dbkeeper-scratch.conf
sudo chown root:root /etc/dbkeeper-scratch.conf && sudo chmod 0644 /etc/dbkeeper-scratch.conf
```

## 3. Regla de sudoers (solo ese binario, sin contraseña)

Reemplaza `dbkeeper` por el usuario que corre la API (el de PM2: `ps -o user= -C node`).

```bash
echo 'dbkeeper ALL=(root) NOPASSWD: /usr/local/sbin/dbkeeper-scratch' | sudo tee /etc/sudoers.d/dbkeeper-scratch
sudo chmod 0440 /etc/sudoers.d/dbkeeper-scratch
sudo visudo -cf /etc/sudoers.d/dbkeeper-scratch
# Prueba como el usuario de la app (no debe pedir contraseña):
sudo -u dbkeeper sudo -n /usr/local/sbin/dbkeeper-scratch check /backup-alloydb
```

## 4. Permisos en GCP (rol personalizado, menor privilegio)

La credencial es la elegida en Configuración → Disco temporal (por defecto la GCP del
catálogo o la cuenta de la VM). Si es la cuenta de la VM, la VM debe tener el scope
`cloud-platform` (o `compute`).

```bash
PROJECT=mi-proyecto
SA=dbkeeper@mi-proyecto.iam.gserviceaccount.com
gcloud iam roles create dbkeeperScratchDisk --project="$PROJECT" \
  --title="DBKeeper - disco temporal" \
  --permissions=compute.disks.create,compute.disks.delete,compute.disks.get,compute.disks.list,compute.disks.use,compute.disks.setLabels,compute.instances.attachDisk,compute.instances.detachDisk,compute.instances.get,compute.zoneOperations.get
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" --role="projects/$PROJECT/roles/dbkeeperScratchDisk"
```

El bucket necesita, como el resto de destinos GCS: `storage.objects.create/get/list`.

## 5. Habilitar y probar

1. `pnpm migrate` (migración `0030_servers_alloydb.sql`) y reiniciar la API.
2. Configuración → **Disco temporal**: habilitar, revisar punto de montaje y tamaños, guardar.
3. **Probar configuración**: debe dar ✔ en VM, credencial, permisos, helper y binarios.
4. Instancias → la instancia AlloyDB → Plataforma **AlloyDB**.
5. Backups → nuevo evento → método **Dump paralelo (directorio)**, bucket de GCP.

## Restaurar un backup

```bash
gcloud storage cp -r gs://<bucket>/<ruta>/<instancia>/<bd>_<amb>_<ts>/ /restore/
# pg_restore de versión >= al pg_dump que lo generó (ver manifest.json → pgDumpMajor)
pg_restore -j 8 --no-owner -d <bd_destino> /restore/<bd>_<amb>_<ts>
# Si el evento excluía event triggers:
pg_restore -j 8 --no-owner -d <bd_destino> -L /restore/<bd>_<amb>_<ts>/restore.list /restore/<bd>_<amb>_<ts>
```

Un backup está completo solo si la carpeta tiene `manifest.json` (se sube al final, tras
verificar cada archivo). Una carpeta sin manifiesto es una subida interrumpida.

## Si algo queda colgado

- Los discos llevan las etiquetas `dbkeeper=scratch` y `dbkeeper-exec=<id de ejecución>`.
  Un recolector los libera al arrancar la API y cada N minutos (Configuración).
- Si no se pudo desmontar, el disco **no** se borra (se avisa por las notificaciones):
  revisar con `findmnt /backup-alloydb` y `lsof +D /backup-alloydb`, y luego
  `sudo /usr/local/sbin/dbkeeper-scratch release /backup-alloydb`.
- Listar discos temporales: `gcloud compute disks list --filter="labels.dbkeeper=scratch"`.
