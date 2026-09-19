#!/usr/bin/env bash
# Genera el par de claves de age con las que se cifran los backups.
#   - La clave PRIVADA queda en el archivo que indiques (fuera del repo). Es lo único
#     que descifra los backups: guardala en un gestor de contraseñas Y en un segundo lugar.
#   - Acá solo se imprime la clave PÚBLICA (age1...), que va a GitHub como secret
#     BACKUP_AGE_RECIPIENT. Con ella se puede cifrar pero NO descifrar.
#
# Uso: scripts/backup/generar-clave.sh [archivo]     (por defecto ~/.kioscos-backup/age.key)
set -Eeuo pipefail
export MSYS_NO_PATHCONV=1

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
IMAGE=kioscos-backup-tools:1
KEYFILE=${1:-$HOME/.kioscos-backup/age.key}

[[ ! -e "$KEYFILE" ]] || { echo "Ya existe $KEYFILE: no lo piso. Si querés otro par, indicá otra ruta." >&2; exit 1; }
docker version >/dev/null 2>&1 || { echo "Docker no está en marcha. Abrí Docker Desktop." >&2; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build -t "$IMAGE" "$HERE"

mkdir -p "$(dirname "$KEYFILE")"
hostpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -am "$1"; else echo "$1"; fi; }
DIRHOST=$(hostpath "$(dirname "$KEYFILE")")
NAME=$(basename "$KEYFILE")

docker run --rm -v "$DIRHOST:/key" "$IMAGE" bash -c "age-keygen -o /key/$NAME 2>/dev/null && chmod 600 /key/$NAME"
echo "Clave PRIVADA guardada en: $KEYFILE"
echo "   -> Copiala YA a tu gestor de contraseñas y a un segundo lugar (pendrive, otra PC)."
echo "   -> Sin ella los backups no se pueden abrir. Nunca la subas a GitHub ni al repo."
echo
echo "Clave PÚBLICA (esta SÍ va a GitHub, secret BACKUP_AGE_RECIPIENT):"
docker run --rm -v "$DIRHOST:/key:ro" "$IMAGE" age-keygen -y "/key/$NAME"
