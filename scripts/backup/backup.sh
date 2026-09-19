#!/usr/bin/env bash
# Backup de Supabase: base (public + auth + storage) y archivos de Storage.
# Todo sale CIFRADO con age (clave pública) y se sube a Cloudflare R2.
#
# Corre DENTRO de la imagen de scripts/backup/Dockerfile (ver .github/workflows/backup.yml).
# Nunca imprime secretos ni nombres de archivos de clientes. Ante cualquier problema
# termina con código distinto de 0 y un ::error:: claro (el job queda en rojo).
#
# Variables de entorno:
#   SUPABASE_DB_URL            (secret) cadena del Session pooler, puerto 5432
#   BACKUP_AGE_RECIPIENT       clave PÚBLICA de age (age1...). La privada NO está en GitHub.
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET   (secrets)
#   INCLUDE_STORAGE            "true" copia también los buckets (requiere las dos siguientes)
#   SUPABASE_URL               https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY  (secret) para bajar los archivos de Storage
#   RETENTION_DAYS             días de retención (30)
#   MIN_KEEP_DB / MIN_KEEP_STORAGE   copias que NUNCA se borran aunque sean viejas (20 / 5)
#   BACKUP_LOCAL_DIR           si está, deja los archivos cifrados ahí y NO sube a R2 (ensayos)
#   OUT_DIR                    dónde dejar summary.md (por defecto /out)
set -Eeuo pipefail

STAGE="inicio"
fail() { echo "::error title=Backup falló::$*"; exit 1; }
trap 'echo "::error title=Backup falló::Se cortó en la etapa: ${STAGE}. Mirá el log de esa etapa más arriba."' ERR

: "${INCLUDE_STORAGE:=false}"
: "${RETENTION_DAYS:=30}"
: "${MIN_KEEP_DB:=20}"
: "${MIN_KEEP_STORAGE:=5}"
: "${OUT_DIR:=/out}"
: "${MIN_DUMP_BYTES:=100000}"
: "${MIN_ROWS_PUBLIC:=1000}"
: "${MIN_TABLES_WITH_DATA:=15}"
export PGCONNECT_TIMEOUT=30

# ---------------------------------------------------------------- validaciones
STAGE="validar configuración"
require() {
  local missing=() v
  for v in "$@"; do [[ -n "${!v:-}" ]] || missing+=("$v"); done
  ((${#missing[@]} == 0)) || fail "Faltan secrets o variables: ${missing[*]}. Se cargan en GitHub → Settings → Secrets and variables → Actions."
}
require SUPABASE_DB_URL BACKUP_AGE_RECIPIENT
[[ -n "${BACKUP_LOCAL_DIR:-}" ]] || require R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
[[ "$INCLUDE_STORAGE" != "true" ]] || require SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY

[[ "$BACKUP_AGE_RECIPIENT" == age1* ]] \
  || fail "BACKUP_AGE_RECIPIENT tiene que ser la clave PÚBLICA de age (empieza con age1). Si pegaste un texto que empieza con AGE-SECRET-KEY, es la privada: sacala de GitHub y generá otro par."
[[ "$SUPABASE_DB_URL" == postgres://* || "$SUPABASE_DB_URL" == postgresql://* ]] \
  || fail "SUPABASE_DB_URL tiene que ser una URI que empiece con postgresql://"
[[ "$SUPABASE_DB_URL" != *"@db."*".supabase.co"* ]] \
  || fail "SUPABASE_DB_URL apunta a la conexión directa (db.<ref>.supabase.co), que es solo IPv6 y GitHub no la alcanza. Usá la cadena del Session pooler (Connect → Session pooler, puerto 5432)."
if [[ "$SUPABASE_DB_URL" =~ @[^/@]+:([0-9]+)/ && "${BASH_REMATCH[1]}" == "6543" ]]; then
  fail "SUPABASE_DB_URL usa el puerto 6543 (Transaction pooler): pg_dump no anda ahí. Usá el Session pooler, puerto 5432."
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT_DIR" "$WORK/bundle" "$WORK/enc"
SUMMARY="$OUT_DIR/summary.md"
{
  echo "## Backup de Supabase — $STAMP"
  echo
} >"$SUMMARY"

human() { numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "$1 B"; }

# ---------------------------------------------------------------- subida a R2 / local
R2_ENDPOINT="${R2_ENDPOINT_URL:-https://${R2_ACCOUNT_ID:-x}.r2.cloudflarestorage.com}"   # R2_ENDPOINT_URL solo para ensayos (MinIO)
export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}" AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}"
export AWS_DEFAULT_REGION=auto AWS_EC2_METADATA_DISABLED=true
# awscli recientes agregan checksums que R2 no acepta; estas dos variables lo evitan.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
s3api() { aws s3api --endpoint-url "$R2_ENDPOINT" "$@"; }

deliver() { # $1 = archivo cifrado, $2 = prefijo (db|storage)
  local file=$1 prefix=$2 name size
  name=$(basename "$file")
  size=$(stat -c %s "$file")
  if [[ -n "${BACKUP_LOCAL_DIR:-}" ]]; then
    mkdir -p "$BACKUP_LOCAL_DIR/$prefix"
    cp "$file" "$BACKUP_LOCAL_DIR/$prefix/$name"
    return
  fi
  aws s3 cp "$file" "s3://${R2_BUCKET}/${prefix}/${name}" --endpoint-url "$R2_ENDPOINT" --only-show-errors \
    || fail "No se pudo subir la copia a R2. Revisá R2_ACCOUNT_ID, R2_BUCKET y que el token de R2 tenga permiso de lectura y escritura sobre ese bucket."
  local remote
  remote=$(s3api head-object --bucket "$R2_BUCKET" --key "${prefix}/${name}" --query ContentLength --output text) \
    || fail "La copia se subió pero R2 no la devuelve al verificarla."
  [[ "$remote" == "$size" ]] \
    || fail "La copia subida a R2 pesa $remote bytes y la local $size: subida corrupta."
}

prune() { # $1 = prefijo, $2 = mínimo a conservar
  [[ -z "${BACKUP_LOCAL_DIR:-}" ]] || return 0
  local prefix=$1 keep=$2 cutoff deleted=0 i=0 key stamp
  cutoff=$(date -u -d "-${RETENTION_DAYS} days" +%Y%m%dT%H%M%SZ)
  local keys
  keys=$(s3api list-objects-v2 --bucket "$R2_BUCKET" --prefix "${prefix}/" --query 'Contents[].Key' --output text \
    | tr '\t' '\n' | grep -E "^${prefix}/kioscos-${prefix}-[0-9]{8}T[0-9]{6}Z\.tar(\.gz)?\.age$" | sort -r || true)
  while IFS= read -r key; do
    [[ -n "$key" ]] || continue
    i=$((i + 1))
    ((i > keep)) || continue
    stamp=${key##*-}
    stamp=${stamp%%.*}
    if [[ "$stamp" < "$cutoff" ]]; then
      s3api delete-object --bucket "$R2_BUCKET" --key "$key" >/dev/null
      deleted=$((deleted + 1))
    fi
  done <<<"$keys"
  echo "Retención (${prefix}): ${i} copias en R2, ${deleted} borradas por tener más de ${RETENTION_DAYS} días."
  echo "- Retención de \`${prefix}/\`: quedan $((i - deleted)) copias; borradas $deleted con más de ${RETENTION_DAYS} días." >>"$SUMMARY"
}

encrypt() { # $1 = entrada, $2 = salida
  age --encrypt -r "$BACKUP_AGE_RECIPIENT" -o "$2" "$1" \
    || fail "age no pudo cifrar. Revisá que BACKUP_AGE_RECIPIENT sea una clave pública válida."
  head -c 21 "$2" | grep -q '^age-encryption.org' || fail "El archivo cifrado no tiene el encabezado de age."
}

# ---------------------------------------------------------------- 1) conexión
STAGE="probar la conexión a la base"
SERVER_VERSION=$(psql "$SUPABASE_DB_URL" -Atqc "show server_version") \
  || fail "No se pudo conectar a la base. SUPABASE_DB_URL tiene que ser la cadena del Session pooler (puerto 5432) con la contraseña correcta; si la contraseña tiene @ : / # ? o %, va codificada (URL-encoded)."
PGDUMP_VERSION=$(pg_dump --version)
echo "Servidor: PostgreSQL ${SERVER_VERSION}. Cliente: ${PGDUMP_VERSION}."
[[ "${SERVER_VERSION%%.*}" -le 17 ]] || fail "El servidor es PostgreSQL ${SERVER_VERSION}, más nuevo que el pg_dump 17 de la imagen. Actualizá scripts/backup/Dockerfile."

# ---------------------------------------------------------------- 2) pg_dump
# Un solo pg_dump de public + auth + storage = una sola foto consistente. Incluye el
# trigger propio de auth.users (on_auth_user_created) y las policies de storage.objects,
# que un dump solo de "public" perdería.
STAGE="pg_dump"
pg_dump "$SUPABASE_DB_URL" --format=custom --compress=6 --no-owner \
  --schema=public --schema=auth --schema=storage --file="$WORK/bundle/db.dump" \
  || fail "pg_dump falló (mirá el error de arriba). Si dice 'permission denied', hay que excluir esa tabla en scripts/backup/backup.sh."

STAGE="verificar el dump"
DUMP_BYTES=$(stat -c %s "$WORK/bundle/db.dump")
((DUMP_BYTES >= MIN_DUMP_BYTES)) || fail "El dump pesa apenas $DUMP_BYTES bytes (mínimo esperado $MIN_DUMP_BYTES): sospechoso, no se sube."
pg_restore -l "$WORK/bundle/db.dump" >"$WORK/toc.txt"
TABLES_WITH_DATA=$(grep -c ' TABLE DATA ' "$WORK/toc.txt" || true)

# Filas por tabla, contadas DEL PROPIO DUMP (no de la base en vivo): así el conteo es
# exacto y sirve para comprobar la restauración.
pg_restore --data-only -f - "$WORK/bundle/db.dump" | awk -F'[ (]' '
  /^COPY / { t = $2; gsub(/"/, "", t); n = 0; inblk = 1; next }
  inblk && /^\\\.$/ { print t "\t" n; inblk = 0; next }
  inblk { n++ }
' | sort >"$WORK/bundle/counts.tsv"
ROWS_PUBLIC=$(awk -F'\t' '$1 ~ /^public\./ { s += $2 } END { print s + 0 }' "$WORK/bundle/counts.tsv")
((ROWS_PUBLIC >= MIN_ROWS_PUBLIC)) || fail "El dump trae solo $ROWS_PUBLIC filas en public (mínimo esperado $MIN_ROWS_PUBLIC): sospechoso, no se sube."
((TABLES_WITH_DATA >= MIN_TABLES_WITH_DATA)) || fail "El dump trae datos de solo $TABLES_WITH_DATA tablas (mínimo esperado $MIN_TABLES_WITH_DATA): sospechoso, no se sube."

pg_restore --schema-only -f - "$WORK/bundle/db.dump" | gzip -9 >"$WORK/bundle/schema.sql.gz"

{
  echo "fecha_utc=$STAMP"
  echo "git_sha=${GIT_SHA:-desconocido}"
  echo "servidor=$SERVER_VERSION"
  echo "cliente=$PGDUMP_VERSION"
  echo "tablas_con_datos=$TABLES_WITH_DATA"
  echo "filas_public=$ROWS_PUBLIC"
  echo "bytes_dump=$DUMP_BYTES"
} >"$WORK/bundle/manifest.txt"

# ---------------------------------------------------------------- 3) cifrar + subir la base
STAGE="cifrar la base"
DB_NAME="kioscos-db-${STAMP}.tar.gz.age"
tar -C "$WORK/bundle" -czf "$WORK/db.tar.gz" db.dump schema.sql.gz manifest.txt counts.tsv
encrypt "$WORK/db.tar.gz" "$WORK/enc/$DB_NAME"
DB_ENC_BYTES=$(stat -c %s "$WORK/enc/$DB_NAME")

STAGE="subir la base a R2"
deliver "$WORK/enc/$DB_NAME" db
{
  echo "- **Base**: \`db/$DB_NAME\` — $(human "$DB_ENC_BYTES") cifrado; $TABLES_WITH_DATA tablas con datos, $ROWS_PUBLIC filas en public."
} >>"$SUMMARY"
echo "Base respaldada: $TABLES_WITH_DATA tablas, $ROWS_PUBLIC filas en public, $(human "$DB_ENC_BYTES") cifrado."

STAGE="retención de la base"
prune db "$MIN_KEEP_DB"

# ---------------------------------------------------------------- 4) Storage
STORAGE_BAD=0
if [[ "$INCLUDE_STORAGE" == "true" ]]; then
  STAGE="listar Storage"
  SDIR="$WORK/storage"
  mkdir -p "$SDIR"
  psql "$SUPABASE_DB_URL" -Atq -F $'\t' -c "
    select bucket_id, name, coalesce(metadata->>'mimetype','application/octet-stream'), coalesce(metadata->>'size','0'),
           coalesce(metadata->>'cacheControl','max-age=3600')
    from storage.objects order by bucket_id, name" >"$SDIR/storage-index.tsv"

  HDR="$WORK/headers.txt"
  {
    echo "apikey: $SUPABASE_SERVICE_ROLE_KEY"
    # Las claves nuevas (sb_secret_...) van solo en apikey; las legacy (JWT) también en Authorization.
    [[ "$SUPABASE_SERVICE_ROLE_KEY" != eyJ* ]] || echo "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
  } >"$HDR"
  chmod 600 "$HDR"

  STAGE="descargar Storage"
  total=0
  ok=0
  while IFS=$'\t' read -r bucket name mime size cache; do
    [[ -n "$bucket" ]] || continue
    total=$((total + 1))
    case "/$name/" in */../* | //*)
      STORAGE_BAD=$((STORAGE_BAD + 1))
      echo "::warning::Objeto con nombre no permitido en el bucket $bucket: se omite."
      continue
      ;;
    esac
    dest="$SDIR/files/$bucket/$name"
    mkdir -p "$(dirname "$dest")"
    enc=$(jq -rn --arg n "$name" '$n | split("/") | map(@uri) | join("/")')
    http=$(curl -sS -o "$dest" -w '%{http_code}' --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 180 \
      -H @"$HDR" "${SUPABASE_URL%/}/storage/v1/object/${bucket}/${enc}" 2>/dev/null) || http=000
    got=0
    [[ -f "$dest" ]] && got=$(stat -c %s "$dest")
    if [[ "$http" != "200" ]] || { [[ "$size" != "0" ]] && [[ "$got" != "$size" ]]; }; then
      STORAGE_BAD=$((STORAGE_BAD + 1))
      rm -f "$dest"
      echo "::warning::No se pudo bajar un objeto del bucket $bucket (HTTP $http)."
      continue
    fi
    ok=$((ok + 1))
  done <"$SDIR/storage-index.tsv"
  echo "Storage: $ok de $total objetos descargados, $STORAGE_BAD con problemas."

  STAGE="cifrar Storage"
  {
    echo "fecha_utc=$STAMP"
    echo "objetos_indice=$total"
    echo "objetos_copiados=$ok"
    echo "objetos_faltantes=$STORAGE_BAD"
  } >"$SDIR/manifest-storage.txt"
  ST_NAME="kioscos-storage-${STAMP}.tar.age"
  tar -C "$SDIR" -cf "$WORK/storage.tar" files storage-index.tsv manifest-storage.txt
  encrypt "$WORK/storage.tar" "$WORK/enc/$ST_NAME"
  ST_ENC_BYTES=$(stat -c %s "$WORK/enc/$ST_NAME")

  STAGE="subir Storage a R2"
  deliver "$WORK/enc/$ST_NAME" storage
  echo "- **Storage**: \`storage/$ST_NAME\` — $(human "$ST_ENC_BYTES") cifrado; $ok de $total objetos." >>"$SUMMARY"

  STAGE="retención de Storage"
  prune storage "$MIN_KEEP_STORAGE"
else
  echo "- Storage: no se copió en esta corrida (se copia una vez por semana)." >>"$SUMMARY"
fi

# ---------------------------------------------------------------- 5) resultado
STAGE="cierre"
if ((STORAGE_BAD > 0)); then
  echo "- ⚠️ **$STORAGE_BAD objetos de Storage no se pudieron copiar.**" >>"$SUMMARY"
  fail "La base se respaldó bien, pero $STORAGE_BAD objetos de Storage no se pudieron copiar (ver advertencias arriba). Revisá SUPABASE_SERVICE_ROLE_KEY y el estado de Storage."
fi
echo "Backup completo."
