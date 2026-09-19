# Herramientas del backup/restauración de Supabase: pg_dump/pg_restore/psql 17
# (la base es Postgres 17.6), age (cifrado), awscli (Cloudflare R2 habla el
# protocolo S3), curl y jq (API de Storage). Las mismas versiones corren en el
# workflow de GitHub y en tu máquina, así que "en mi máquina anda" vale.
FROM postgres:17-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends age awscli curl jq ca-certificates tar gzip \
 && rm -rf /var/lib/apt/lists/*

# La imagen base arranca un servidor de Postgres: acá solo queremos las herramientas.
ENTRYPOINT []
CMD ["bash"]
