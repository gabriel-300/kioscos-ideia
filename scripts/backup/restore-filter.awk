# Filtro de la lista de contenido del dump (pg_restore -l) para restaurar en un
# proyecto Supabase NUEVO. El dump trae public + auth + storage, pero un proyecto
# nuevo ya trae su propio esquema de auth y de storage (los crea Supabase), así que:
#
#   public   -> todo (esquema, datos, funciones, policies, permisos), salvo el
#               CREATE SCHEMA/comentarios del esquema, que ya existe.
#   auth     -> solo los DATOS (usuarios, identidades...), las secuencias y el trigger
#               on_auth_user_created; NO auth.schema_migrations (lo maneja Supabase).
#   storage  -> solo la tabla buckets (datos) y las policies de storage.objects.
#               Los objetos (archivos) se re-suben por la API desde la copia de Storage.
#
# Uso: pg_restore -l db.dump | awk -f restore-filter.awk > lista.txt
#      pg_restore -L lista.txt ...
/^;/ { next }
{
  line = $0
  sub(/^[0-9]+; [0-9]+ [0-9]+ /, "", line)   # queda "TIPO esquema nombre dueño"
  keep = 0
  if (line ~ /^TABLE DATA auth schema_migrations /) keep = 0
  else if (line ~ /^TABLE DATA auth /)           keep = 1
  else if (line ~ /^SEQUENCE SET auth /)         keep = 1
  else if (line ~ /^TRIGGER auth /)              keep = 1
  else if (line ~ /^TABLE DATA storage buckets /) keep = 1
  else if (line ~ /^POLICY storage /)            keep = 1
  else if (line ~ /^[A-Z][A-Z ]* public /)       keep = 1
  if (keep) print $0
}
