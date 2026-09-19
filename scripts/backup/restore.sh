#!/usr/bin/env bash
# Lanzador de la restauración (corre en tu máquina; el trabajo lo hace Docker).
# Requiere Docker Desktop en marcha. NO restaura en producción: el script interno lo impide.
#
#   scripts/backup/restore.sh --key ~/.kioscos-backup/age.key --desde-r2
#   scripts/backup/restore.sh --key ~/.kioscos-backup/age.key --desde-carpeta ./descargas
#   opciones: --sin-storage   --env <archivo>   --db-objeto <nombre>   --storage-objeto <nombre>   --si
#
# Los datos del proyecto DESTINO se leen de variables de entorno o del archivo --env
# (líneas CLAVE=valor, SIN comillas). Si faltan, se piden por teclado sin mostrarlas:
#   RESTORE_DB_URL  RESTORE_SUPABASE_URL  RESTORE_SERVICE_ROLE_KEY
#   y, para --desde-r2:  R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BUCKET
set -Eeuo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash en Windows: que no reescriba las rutas de -v

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
IMAGE=kioscos-backup-tools:1
KEY="" SOURCE="" DIR="" SKIP=0 ENVFILE="" YES=0 DBOBJ="" STOBJ=""

while (($#)); do
  case "$1" in
    --key) KEY=$2; shift 2 ;;
    --desde-r2) SOURCE=r2; shift ;;
    --desde-carpeta) SOURCE=dir; DIR=$2; shift 2 ;;
    --sin-storage) SKIP=1; shift ;;
    --env) ENVFILE=$2; shift 2 ;;
    --db-objeto) DBOBJ=$2; shift 2 ;;
    --storage-objeto) STOBJ=$2; shift 2 ;;
    --si) YES=1; shift ;;
    -h | --help) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$KEY" && -f "$KEY" ]] || { echo "Indicá la clave privada de age con --key <archivo>." >&2; exit 2; }
[[ -n "$SOURCE" ]] || { echo "Indicá --desde-r2 o --desde-carpeta <dir>." >&2; exit 2; }
docker version >/dev/null 2>&1 || { echo "Docker no está en marcha. Abrí Docker Desktop y esperá a que diga 'running'." >&2; exit 1; }

hostpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -am "$1"; else echo "$1"; fi; }

if [[ -n "$ENVFILE" ]]; then
  [[ -f "$ENVFILE" ]] || { echo "No existe $ENVFILE" >&2; exit 2; }
  # Se lee línea a línea (sin "source"): una URL con & o ? no se interpreta como comando.
  while IFS='=' read -r k v || [[ -n "$k" ]]; do
    v=${v%$'\r'}
    [[ "$k" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
    export "$k=$v"
  done <"$ENVFILE"
fi
ask() { # $1 = variable, $2 = texto, $3 = "secreto"
  [[ -z "${!1:-}" ]] || return 0
  if [[ "${3:-}" == secreto ]]; then read -rsp "$2: " "$1"; echo; else read -rp "$2: " "$1"; fi
  export "${1?}"
}
ask RESTORE_DB_URL "Cadena del Session pooler del proyecto DESTINO (puerto 5432)" secreto
if ((SKIP == 0)); then
  ask RESTORE_SUPABASE_URL "URL del proyecto DESTINO (https://xxxx.supabase.co)"
  ask RESTORE_SERVICE_ROLE_KEY "service_role / secret key del proyecto DESTINO" secreto
fi
if [[ "$SOURCE" == "r2" ]]; then
  ask R2_ACCOUNT_ID "R2 Account ID"
  ask R2_BUCKET "Nombre del bucket de R2"
  ask R2_ACCESS_KEY_ID "R2 Access Key ID" secreto
  ask R2_SECRET_ACCESS_KEY "R2 Secret Access Key" secreto
fi

if ((YES == 0)); then
  echo "Se va a restaurar en el proyecto DESTINO (debe ser NUEVO y VACÍO). Producción está protegida."
  read -rp "Escribí RESTAURAR para continuar: " ok
  [[ "$ok" == "RESTAURAR" ]] || { echo "Cancelado."; exit 1; }
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Construyendo la imagen de herramientas (una sola vez)..."
  docker build -t "$IMAGE" "$HERE"
fi

MOUNTS=(-v "$(hostpath "$HERE"):/scripts:ro" -v "$(hostpath "$KEY"):/key/age.key:ro")
[[ "$SOURCE" != "dir" ]] || MOUNTS+=(-v "$(hostpath "$DIR"):/backups:ro")

docker run --rm -i \
  "${MOUNTS[@]}" \
  -e RESTORE_DB_URL -e RESTORE_SUPABASE_URL -e RESTORE_SERVICE_ROLE_KEY \
  -e R2_ACCOUNT_ID -e R2_ACCESS_KEY_ID -e R2_SECRET_ACCESS_KEY -e R2_BUCKET -e R2_ENDPOINT_URL \
  -e CONFIRM_RESTORE=SI -e BACKUP_SOURCE="$SOURCE" -e SKIP_STORAGE="$SKIP" \
  -e DB_OBJECT="$DBOBJ" -e STORAGE_OBJECT="$STOBJ" \
  "$IMAGE" bash /scripts/restore-inside.sh
