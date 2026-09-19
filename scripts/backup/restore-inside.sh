#!/usr/bin/env bash
# Restaura una copia de backup en un proyecto Supabase NUEVO (nunca en producción).
# Corre DENTRO de la imagen de scripts/backup/Dockerfile; se lanza con restore.sh.
#
# Variables de entorno:
#   RESTORE_DB_URL             Session pooler (puerto 5432) del proyecto DESTINO
#   RESTORE_SUPABASE_URL       https://<ref-destino>.supabase.co
#   RESTORE_SERVICE_ROLE_KEY   service_role / secret key del proyecto DESTINO (para subir archivos)
#   CONFIRM_RESTORE            tiene que valer SI
#   AGE_KEY_FILE               clave PRIVADA de age (por defecto /key/age.key)
#   BACKUP_SOURCE              dir (archivos en /backups) | r2
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET   (solo con r2)
#   DB_OBJECT / STORAGE_OBJECT (opcional) nombre exacto a usar en vez de la copia más reciente
#   SKIP_STORAGE               1 = no restaurar archivos de Storage
#   PROD_REF                   proyecto que NUNCA se puede pisar (quejjgvqpbxgepoxdrli)
set -Eeuo pipefail

STAGE="inicio"
die() { echo "❌ $*" >&2; exit 1; }
trap 'echo "❌ Se cortó en la etapa: ${STAGE}. Nada se da por restaurado." >&2' ERR
say() { echo "▶ $*"; }

: "${AGE_KEY_FILE:=/key/age.key}"
: "${BACKUP_SOURCE:=dir}"
: "${PROD_REF:=quejjgvqpbxgepoxdrli}"
: "${SKIP_STORAGE:=0}"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# ---------------------------------------------------------------- 0) barandas de seguridad
STAGE="validar destino"
for v in RESTORE_DB_URL; do [[ -n "${!v:-}" ]] || die "Falta $v."; done
[[ "${CONFIRM_RESTORE:-}" == "SI" ]] || die "Falta la confirmación explícita (CONFIRM_RESTORE=SI)."
[[ -f "$AGE_KEY_FILE" ]] || die "No encuentro la clave privada de age en $AGE_KEY_FILE."
if [[ "$RESTORE_DB_URL" == *"$PROD_REF"* || "${RESTORE_SUPABASE_URL:-}" == *"$PROD_REF"* ]]; then
  die "El destino es el proyecto de PRODUCCIÓN ($PROD_REF). Esta restauración es solo para un proyecto nuevo y vacío. Abortado sin tocar nada."
fi
[[ "$RESTORE_DB_URL" != *"@db."*".supabase.co"* ]] || die "RESTORE_DB_URL apunta a la conexión directa (solo IPv6). Usá el Session pooler, puerto 5432."
if [[ "$RESTORE_DB_URL" =~ @[^/@]+:([0-9]+)/ && "${BASH_REMATCH[1]}" == "6543" ]]; then
  die "RESTORE_DB_URL usa el puerto 6543 (Transaction pooler). Usá el Session pooler, puerto 5432."
fi
if [[ "$SKIP_STORAGE" != "1" ]]; then
  for v in RESTORE_SUPABASE_URL RESTORE_SERVICE_ROLE_KEY; do [[ -n "${!v:-}" ]] || die "Falta $v (o usá --sin-storage)."; done
fi

psql_t() { psql "$RESTORE_DB_URL" -v ON_ERROR_STOP=1 -Atq "$@"; }
psql_t -c "select 1" >/dev/null || die "No se pudo conectar al proyecto destino. Revisá RESTORE_DB_URL (Session pooler, contraseña URL-encoded)."

n_public=$(psql_t -c "select count(*) from information_schema.tables where table_schema='public'")
n_users=$(psql_t -c "select count(*) from auth.users")
n_buckets=$(psql_t -c "select count(*) from storage.buckets")
if [[ "$n_public" != "0" || "$n_users" != "0" || "$n_buckets" != "0" ]]; then
  die "El destino NO está vacío (tablas en public: $n_public, usuarios: $n_users, buckets: $n_buckets). Restaurar encima mezclaría datos. Usá un proyecto nuevo, o vaciá este: Settings → General → Delete project y crear otro."
fi
say "Destino vacío y distinto de producción. Sigo."

# ---------------------------------------------------------------- 1) conseguir la copia
STAGE="obtener la copia"
R2_ENDPOINT="${R2_ENDPOINT_URL:-https://${R2_ACCOUNT_ID:-x}.r2.cloudflarestorage.com}"   # R2_ENDPOINT_URL solo para ensayos (MinIO)
export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}" AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}"
export AWS_DEFAULT_REGION=auto AWS_EC2_METADATA_DISABLED=true
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
s3api() { aws s3api --endpoint-url "$R2_ENDPOINT" "$@"; }

newest() { # $1 = prefijo (db|storage)
  if [[ "$BACKUP_SOURCE" == "r2" ]]; then
    s3api list-objects-v2 --bucket "$R2_BUCKET" --prefix "$1/" --query 'Contents[].Key' --output text \
      | tr '\t' '\n' | grep -E "^$1/kioscos-$1-[0-9]{8}T[0-9]{6}Z\.tar(\.gz)?\.age$" | sort | tail -1 || true
  else
    # La carpeta puede ser plana o tener subcarpetas db/ y storage/ (como en R2).
    find /backups -type f -printf '%f\n' 2>/dev/null | grep -E "^kioscos-$1-[0-9]{8}T[0-9]{6}Z\.tar(\.gz)?\.age$" | sort | tail -1 || true
  fi
}
fetch() { # $1 = clave/archivo, $2 = destino local
  if [[ "$BACKUP_SOURCE" == "r2" ]]; then
    aws s3 cp "s3://${R2_BUCKET}/$1" "$2" --endpoint-url "$R2_ENDPOINT" --only-show-errors
  else
    local src
    src=$(find /backups -type f -name "$(basename "$1")" | head -1)
    [[ -n "$src" ]] || die "No encuentro $(basename "$1") en la carpeta de copias."
    cp "$src" "$2"
  fi
}

DB_KEY="${DB_OBJECT:-$(newest db)}"
[[ -n "$DB_KEY" ]] || die "No encontré ninguna copia de la base (kioscos-db-*.age)."
say "Copia de la base: $(basename "$DB_KEY")"
fetch "$DB_KEY" "$WORK/db.tar.gz.age"

STAGE="descifrar la base"
age --decrypt -i "$AGE_KEY_FILE" -o "$WORK/db.tar.gz" "$WORK/db.tar.gz.age" \
  || die "No se pudo descifrar. ¿Es la clave privada que corresponde a la pública cargada en GitHub (BACKUP_AGE_RECIPIENT)?"
mkdir -p "$WORK/db"
tar -C "$WORK/db" -xzf "$WORK/db.tar.gz"
say "Manifest de la copia:"
sed 's/^/    /' "$WORK/db/manifest.txt"

# ---------------------------------------------------------------- 2) restaurar la base
STAGE="armar la lista de restauración"
pg_restore -l "$WORK/db/db.dump" | awk -f "$SCRIPT_DIR/restore-filter.awk" >"$WORK/lista.txt"
say "Entradas a restaurar: $(wc -l <"$WORK/lista.txt")"

STAGE="restaurar la base"
# En Supabase el rol postgres puede pasar a session_replication_role=replica (evita que
# los triggers de auth/public disparen mientras se cargan los datos). Si no puede, sigue igual.
PRE=""
if psql_t -c "set session_replication_role = replica" >/dev/null 2>&1; then
  PRE="SET session_replication_role = replica;"
else
  say "Aviso: no se puede usar session_replication_role; se restaura sin eso."
fi
{
  echo "$PRE"
  pg_restore --no-owner -L "$WORK/lista.txt" -f - "$WORK/db/db.dump"
} | psql "$RESTORE_DB_URL" -q -v ON_ERROR_STOP=1 --single-transaction >"$WORK/restore.log" 2>"$WORK/restore.err" \
  || { echo "---- errores de la restauración ----" >&2; head -40 "$WORK/restore.err" >&2; die "La restauración de la base falló y se deshizo entera (una sola transacción). Mirá el error de arriba."; }
say "Base restaurada (una sola transacción: o entra todo o no entra nada)."

# ---------------------------------------------------------------- 3) verificar la base
STAGE="verificar filas"
# counts.tsv trae las filas de cada tabla CONTADAS DEL DUMP; se comparan con lo que hay ahora.
awk -F'\t' '
  ($1 ~ /^public\./ || $1 ~ /^auth\./ || $1 == "storage.buckets") && $1 != "auth.schema_migrations" {
    split($1, p, "."); printf "select %c%s%c, count(*)::text from %c%s%c.%c%s%c\n", 39, $1, 39, 34, p[1], 34, 34, p[2], 34
  }' "$WORK/db/counts.tsv" | paste -sd'@' | sed 's/@/ union all /g' >"$WORK/verify.sql"
psql_t -F $'\t' -f "$WORK/verify.sql" | sort >"$WORK/despues.tsv"
grep -E $'^(public\\.|auth\\.|storage\\.buckets\t)' "$WORK/db/counts.tsv" | grep -v '^auth.schema_migrations' | sort >"$WORK/antes.tsv"
if diff -q "$WORK/antes.tsv" "$WORK/despues.tsv" >/dev/null; then
  say "Verificación de filas: $(wc -l <"$WORK/antes.tsv") tablas, TODAS con las mismas filas que el backup."
else
  echo "Diferencias (tabla · filas en el backup · filas restauradas):" >&2
  join -t $'\t' -a1 -a2 -e '?' -o 0,1.2,2.2 "$WORK/antes.tsv" "$WORK/despues.tsv" | awk -F'\t' '$2 != $3' >&2
  die "Hay tablas con distinta cantidad de filas."
fi

# ---------------------------------------------------------------- 4) Storage
if [[ "$SKIP_STORAGE" == "1" ]]; then
  say "Storage: omitido (--sin-storage). Los buckets quedaron creados pero SIN archivos."
else
  STAGE="obtener y descifrar Storage"
  ST_KEY="${STORAGE_OBJECT:-$(newest storage)}"
  [[ -n "$ST_KEY" ]] || die "No encontré ninguna copia de Storage (kioscos-storage-*.age). Usá --sin-storage si querés omitirlo."
  say "Copia de Storage: $(basename "$ST_KEY")"
  fetch "$ST_KEY" "$WORK/storage.tar.age"
  age --decrypt -i "$AGE_KEY_FILE" -o "$WORK/storage.tar" "$WORK/storage.tar.age" || die "No se pudo descifrar la copia de Storage."
  mkdir -p "$WORK/st"
  tar -C "$WORK/st" -xf "$WORK/storage.tar"
  sed 's/^/    /' "$WORK/st/manifest-storage.txt"

  STAGE="subir archivos a Storage"
  HDR="$WORK/headers.txt"
  {
    echo "apikey: $RESTORE_SERVICE_ROLE_KEY"
    [[ "$RESTORE_SERVICE_ROLE_KEY" != eyJ* ]] || echo "Authorization: Bearer $RESTORE_SERVICE_ROLE_KEY"
  } >"$HDR"
  chmod 600 "$HDR"
  total=0 up=0 bad=0
  while IFS=$'\t' read -r bucket name mime size cache; do
    [[ -n "$bucket" ]] || continue
    total=$((total + 1))
    file="$WORK/st/files/$bucket/$name"
    if [[ ! -f "$file" ]]; then bad=$((bad + 1)); continue; fi   # ya figuraba como faltante en el backup
    enc=$(jq -rn --arg n "$name" '$n | split("/") | map(@uri) | join("/")')
    http=$(curl -sS -o "$WORK/up.out" -w '%{http_code}' --retry 3 --retry-delay 2 --max-time 180 -X POST \
      -H @"$HDR" -H "Content-Type: ${mime:-application/octet-stream}" -H "cache-control: ${cache:-max-age=3600}" -H "x-upsert: true" \
      --data-binary @"$file" "${RESTORE_SUPABASE_URL%/}/storage/v1/object/${bucket}/${enc}" 2>/dev/null) || http=000
    if [[ "$http" == "200" || "$http" == "201" ]]; then up=$((up + 1)); else bad=$((bad + 1)); echo "  ⚠ no se pudo subir un objeto de $bucket (HTTP $http): $(head -c 200 "$WORK/up.out")"; fi
  done <"$WORK/st/storage-index.tsv"
  say "Storage: $up de $total objetos subidos, $bad con problemas."

  STAGE="verificar Storage"
  objs=$(psql_t -c "select count(*) from storage.objects")
  say "storage.objects en el destino: $objs (índice del backup: $total)."
  [[ "$objs" == "$total" && "$bad" == "0" ]] || die "Storage no quedó completo."
fi

echo
echo "✅ RESTAURACIÓN COMPLETA Y VERIFICADA."
echo "   Recordá: los usuarios conservan su contraseña, pero las sesiones abiertas dejan de valer (el proyecto nuevo tiene otro JWT secret)."
