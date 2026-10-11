#!/usr/bin/env bash
# dbkeeper-scratch — helper root del disco temporal del dump paralelo (pg_parallel).
#
# DBKeeper corre sin privilegios; este script es lo ÚNICO que ejecuta como root,
# vía sudoers (ver ops/README-scratch.md). Hace solo tres cosas y valida todo por
# su cuenta, sin confiar en los argumentos que recibe:
#
#   check   <punto-de-montaje>               herramientas presentes y montaje libre
#   prepare <device-name> <punto-de-montaje> formatea (ext4) y monta un disco NUEVO
#   release <punto-de-montaje>               sync + desmonta (nunca lazy)
#
# Garantías:
#   - El disco se identifica por /dev/disk/by-id/google-<device-name> (nombre
#     estable de GCE), nunca por /dev/sdX, y el device-name debe ser dbk-scratch-*.
#   - Nunca formatea un disco con firma (sistema de archivos o tabla de
#     particiones), con particiones, montado o que sea el disco de arranque.
#   - Solo monta/desmonta en las rutas de ALLOWED_MOUNTS.
#   - release solo desmonta un disco formateado por este script (etiqueta).
#
# Instalación: install -o root -g root -m 0755 dbkeeper-scratch.sh /usr/local/sbin/dbkeeper-scratch
set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077

# Rutas donde se permite montar el disco (separadas por espacio). Se pueden
# redefinir en /etc/dbkeeper-scratch.conf (debe ser de root y no escribible por otros).
ALLOWED_MOUNTS="/backup-alloydb"
CONF=/etc/dbkeeper-scratch.conf
if [[ -f "$CONF" ]]; then
  if [[ "$(stat -c '%u' "$CONF")" != "0" ]] || [[ "$(stat -c '%A' "$CONF")" =~ ^.....w|^........w ]]; then
    echo "ERR $CONF debe ser de root y no escribible por grupo/otros" >&2
    exit 2
  fi
  # shellcheck source=/dev/null
  . "$CONF"
fi

FS_LABEL=dbkscratch
DEVICE_RE='^dbk-scratch-[a-z0-9-]{1,40}$'

die() {
  echo "ERR $*" >&2
  exit 1
}

valid_mount() {
  local mp="$1" allowed
  [[ "$mp" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "punto de montaje inválido: $mp"
  [[ "$mp" != *"/.."* && "$mp" != *"/./"* ]] || die "punto de montaje inválido: $mp"
  for allowed in $ALLOWED_MOUNTS; do
    [[ "$mp" == "$allowed" ]] && return 0
  done
  die "punto de montaje no permitido: $mp (permitidos: $ALLOWED_MOUNTS; ver $CONF)"
}

cmd_check() {
  local mp="$1" tool missing=""
  valid_mount "$mp"
  for tool in mkfs.ext4 blkid lsblk findmnt mountpoint udevadm mount umount sync readlink; do
    command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
  done
  [[ -z "$missing" ]] || die "faltan herramientas:$missing"
  if mountpoint -q "$mp"; then
    die "$mp ya tiene algo montado"
  fi
  echo "OK herramientas presentes; $mp libre"
}

cmd_prepare() {
  local name="$1" mp="$2" dev real root_src root_disk i
  [[ "$name" =~ $DEVICE_RE ]] || die "device-name inválido: $name"
  valid_mount "$mp"
  [[ -n "${SUDO_UID:-}" && -n "${SUDO_GID:-}" ]] || die "debe invocarse con sudo desde el usuario de DBKeeper"
  mountpoint -q "$mp" && die "$mp ya tiene algo montado"

  dev="/dev/disk/by-id/google-$name"
  for i in $(seq 1 60); do
    [[ -b "$dev" ]] && break
    udevadm settle -t 2 >/dev/null 2>&1 || true
    sleep 1
  done
  [[ -b "$dev" ]] || die "no apareció $dev tras adjuntar el disco"
  real="$(readlink -f "$dev")"

  # Nunca el disco de arranque.
  root_src="$(findmnt -n -o SOURCE /)"
  root_disk="$(lsblk -no PKNAME "$root_src" 2>/dev/null | head -n1 || true)"
  [[ -n "$root_disk" && "/dev/$root_disk" == "$real" ]] && die "$real es el disco de arranque"
  [[ "$root_src" == "$real" ]] && die "$real es el disco de arranque"

  # Disco nuevo: sin particiones, sin montajes y sin ninguna firma.
  [[ "$(lsblk -nr -o NAME "$real" | wc -l)" -eq 1 ]] || die "$real tiene particiones; no se formatea"
  lsblk -nr -o MOUNTPOINT "$real" | grep -q . && die "$real está montado; no se formatea"
  if blkid -p "$real" >/dev/null 2>&1; then
    die "$real ya tiene un sistema de archivos o firma; no se formatea"
  fi

  echo "Formateando $real (ext4, sin reserva de root)…"
  mkfs.ext4 -q -F -m 0 -L "$FS_LABEL" -E lazy_itable_init=0,lazy_journal_init=0,discard "$real"
  mkdir -p "$mp"
  mount -o defaults,discard,nodev,nosuid,noexec "$real" "$mp"
  chown "$SUDO_UID:$SUDO_GID" "$mp"
  chmod 0750 "$mp"
  echo "OK $real montado en $mp"
}

cmd_release() {
  local mp="$1" src label i
  valid_mount "$mp"
  if ! mountpoint -q "$mp"; then
    echo "OK $mp no estaba montado"
    return 0
  fi
  src="$(findmnt -n -o SOURCE "$mp")"
  label="$(blkid -s LABEL -o value "$src" 2>/dev/null || true)"
  [[ "$label" == "$FS_LABEL" ]] || die "$mp no es un disco temporal de DBKeeper (etiqueta '$label'); no se desmonta"
  sync
  for i in 1 2 3 4 5 6; do
    umount "$mp" 2>/dev/null && break
    sleep 5
  done
  mountpoint -q "$mp" && die "no se pudo desmontar $mp (en uso)"
  echo "OK $mp desmontado"
}

case "${1:-}" in
  check)
    [[ $# -eq 2 ]] || die "uso: check <punto-de-montaje>"
    cmd_check "$2"
    ;;
  prepare)
    [[ $# -eq 3 ]] || die "uso: prepare <device-name> <punto-de-montaje>"
    cmd_prepare "$2" "$3"
    ;;
  release)
    [[ $# -eq 2 ]] || die "uso: release <punto-de-montaje>"
    cmd_release "$2"
    ;;
  *)
    die "uso: dbkeeper-scratch {check|prepare|release} …"
    ;;
esac
