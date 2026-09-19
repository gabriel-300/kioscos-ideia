# Backups y restauración

Supabase está en plan **Free: no hace backups ni tiene recuperación a un punto en el tiempo**. Esto los reemplaza.
Un workflow de GitHub copia la base y los archivos de Storage, los **cifra** y los guarda en **Cloudflare R2**.
Si la base se pierde, se restaura desde ahí en un proyecto Supabase nuevo.

> **Regla de oro:** un backup que nunca se restauró no es un backup. La restauración se ensaya al menos una vez por
> trimestre (ver §7) y cada vez que se toque `scripts/backup/`.

## 1. Qué se copia y qué NO

| Se copia | Dónde queda |
|---|---|
| Base `public` (esquema + datos: tablas, funciones, RPCs, policies, permisos, secuencias) | `db/kioscos-db-<fecha>.tar.gz.age` |
| Base `auth` (usuarios, identidades, contraseñas hasheadas) y el trigger propio `on_auth_user_created` | idem |
| `storage.buckets` y las policies de `storage.objects` (metadatos de Storage) | idem |
| Esquema en SQL legible (`schema.sql.gz`) y conteo de filas por tabla (`counts.tsv`) | idem |
| Archivos de Storage: buckets `remitos` y `product-images` | `storage/kioscos-storage-<fecha>.tar.age` |

**NO se copia** (hay que rehacerlo a mano en el proyecto nuevo): la configuración de Auth (URL del sitio, redirects,
SMTP, proveedores, políticas de contraseña), las claves de API y el JWT secret (el proyecto nuevo trae otras),
los secrets del Worker de Cloudflare, y cualquier cosa fuera de Supabase (Mercado Pago, WhatsApp, n8n). Las sesiones
abiertas dejan de valer al cambiar de proyecto: todos tienen que volver a iniciar sesión (con la misma contraseña).

## 2. Cómo funciona

- **Cuándo:** `.github/workflows/backup.yml`, cada 6 horas (03:17, 09:17, 15:17 y 21:17 UTC = 00:17, 06:17, 12:17 y
  18:17 en Argentina). La corrida de las 03:17 UTC copia también Storage; las otras tres solo la base. También se puede
  lanzar a mano: Actions → Backup → Run workflow.
- **Cómo:** una imagen Docker con Postgres 17 (`scripts/backup/Dockerfile`) corre `scripts/backup/backup.sh`:
  un solo `pg_dump` de `public + auth + storage` (una foto consistente), verificaciones de sanidad (tamaño mínimo,
  filas mínimas), conteo de filas del propio dump, cifrado con **age** y subida a R2 con verificación de tamaño.
- **Cifrado:** clave pública/privada de age. En GitHub solo está la **pública** (`BACKUP_AGE_RECIPIENT`): con ella se
  cifra pero no se descifra. La **privada** queda en tu poder; ni GitHub ni R2 ni Claude pueden abrir las copias.
  El repo es público y los logs también: el script nunca imprime secretos ni nombres de archivos de clientes.
- **Retención:** 30 días. Después de cada copia buena se borran las de más de 30 días, **pero nunca bajan de 20 copias
  de base y 5 de Storage** aunque sean viejas: si el backup dejara de funcionar un mes, no se pierde lo que ya había.
- **Aviso de fallo:** si algo falla, el job queda en **rojo** con un `::error::` que dice qué etapa y qué revisar, y
  GitHub manda el mail de «workflow failed» a quien mantiene el workflow. Revisá en GitHub → Settings → Notifications →
  Actions que estén activadas las notificaciones de workflows fallidos. Una corrida que **nunca arranca** no avisa a
  nadie: mirá la pestaña Actions de vez en cuando (ver §6).

## 3. Puesta en marcha (una sola vez)

**Secrets** (GitHub → Settings → Secrets and variables → Actions → New repository secret). Nunca se pegan en chats,
en el repo ni en comandos.

| Secret | Qué es |
|---|---|
| `SUPABASE_DB_URL` | Cadena del **Session pooler** (Supabase → Connect → Session pooler, puerto **5432**) con la contraseña real. Si la contraseña tiene `@ : / # ? %`, va codificada (URL-encoded). La conexión directa NO sirve (solo IPv6) ni el Transaction pooler (6543) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave `service_role` (o secret key) del proyecto: sirve para bajar los archivos de Storage |
| `BACKUP_AGE_RECIPIENT` | Clave **pública** de age (`age1…`). Se genera con `scripts/backup/generar-clave.sh` |
| `R2_ACCOUNT_ID`, `R2_BUCKET` | Id de cuenta de Cloudflare y nombre del bucket |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Token de API de R2 con permiso «Object Read & Write» **solo sobre ese bucket** |
| `NEXT_PUBLIC_SUPABASE_URL` | Ya existe (lo usa el deploy) |

**Clave de cifrado:** `scripts/backup/generar-clave.sh` deja la clave privada en `~/.kioscos-backup/age.key` y muestra
la pública. Guardá la privada **en un gestor de contraseñas y en un segundo lugar** (pendrive, otra PC). **Si se
pierde, todos los backups quedan ilegibles para siempre.** Nunca la subas a GitHub.

## 4. Restaurar (recuperación real o ensayo)

Requiere Docker Desktop en marcha, la clave privada y un proyecto Supabase **nuevo y vacío**.

1. Crear un proyecto Supabase nuevo (misma región, `sa-east-1`; Postgres 17). No correr ninguna migración en él.
2. En ese proyecto: Connect → **Session pooler** (puerto 5432) → copiar la cadena. Settings → API → copiar la URL y la
   `service_role`.
3. Ejecutar, desde la raíz del repo:
   ```
   scripts/backup/restore.sh --key ~/.kioscos-backup/age.key --desde-r2
   ```
   Pide por teclado (sin mostrarlos) los datos del proyecto **destino** y de R2, y la palabra `RESTAURAR`.
   Alternativas: `--desde-carpeta <dir>` si ya bajaste los archivos `.age`, `--sin-storage`, `--db-objeto <nombre>`
   para elegir una copia que no sea la última, `--env <archivo>` con las variables (`CLAVE=valor`, sin comillas).
4. El script termina con «✅ RESTAURACIÓN COMPLETA Y VERIFICADA» solo si: la base entró entera (una sola
   transacción: o entra todo o no entra nada), **cada tabla** tiene las mismas filas que el backup, y los archivos de
   Storage se subieron y coinciden en cantidad.

**Barandas:** se niega a correr si el destino es el proyecto de producción (`quejjgvqpbxgepoxdrli`), si el destino no
está vacío, o si la clave no corresponde a la copia.

**Si es una recuperación real** (la base de producción se perdió), después de restaurar:
1. Actualizar la app para que apunte al proyecto nuevo: secrets de build en GitHub (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`), secrets del Worker (`SUPABASE_SERVICE_ROLE_KEY`, ver `docs/architecture.md` §
   Variables de entorno y secrets) y volver a desplegar.
2. Rehacer la configuración de Auth (URL del sitio, redirects, SMTP) y, si hace falta, reconfigurar el webhook de
   Mercado Pago y demás integraciones que apunten a URLs.
3. Actualizar los secrets del backup (`SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`) y
   el valor de `PROD_REF` en `scripts/backup/restore-inside.sh` (es la baranda que impide restaurar sobre producción).
4. Avisar al personal: hay que iniciar sesión de nuevo.

## 5. Costo en egress de Supabase (importante)

El backup **lee** la base y Storage, y eso cuenta en el egress del plan Free (5 GB por ciclo; a 19/09 el uso normal era
0,8 GB). Estimado: dump ≈ hasta 20 MB (la mitad es `mercadopago_qr_orders`) × 4 por día ≈ **2 GB/mes**, más Storage
≈ 22 MB × 1 por día ≈ **0,7 GB/mes**. Total ≈ 2,7 GB/mes adicionales. **Es una estimación**: hay que mirar Supabase →
Organization → Usage unos días después de la primera corrida y compararla. Para bajarlo, editar los `cron` de
`backup.yml`: pasar a 2 o 1 corridas por día para la base, o hacer Storage semanal. Un backup que hace pasar la
organización de la cuota (y la restringe) es peor que uno menos frecuente.

## 6. Si el backup falla

Mirar el log del paso «Backup cifrado a R2»: la línea marcada como error dice qué etapa y qué revisar.

| Mensaje | Causa y arreglo |
|---|---|
| `Faltan secrets o variables: …` | Falta cargar ese secret en GitHub |
| `SUPABASE_DB_URL apunta a la conexión directa` / `usa el puerto 6543` | Usar la cadena del **Session pooler**, puerto 5432 |
| `No se pudo conectar a la base` | Contraseña equivocada o sin URL-encoding; proyecto pausado; o proyecto restringido por cuota (402) |
| `pg_dump falló … permission denied` | Una tabla nueva de Supabase que `postgres` no puede leer: excluirla con `--exclude-table-data` en `backup.sh` |
| `El dump pesa apenas … / trae solo … filas` | El dump salió vacío o truncado: no se sube. Investigar antes de reintentar |
| `BACKUP_AGE_RECIPIENT tiene que ser la clave PÚBLICA` | Se pegó la clave equivocada. Si se pegó la privada, **retirarla de GitHub y generar otro par** |
| `No se pudo subir la copia a R2` | Token de R2 vencido, bucket mal escrito o token sin permiso de escritura sobre el bucket |
| `objetos de Storage no se pudieron copiar` | La base sí se respaldó. Revisar `SUPABASE_SERVICE_ROLE_KEY` y el estado de Storage |

Además: el schedule puede retrasarse horas cuando GitHub tiene carga, y en repos públicos GitHub **desactiva** los
schedule tras 60 días sin actividad en el repo. Cada tanto abrir Actions → Backup y comprobar que la última corrida
verde es de hoy.

## 7. Verificación periódica

Cada trimestre, y siempre que se cambie `scripts/backup/`: crear un proyecto Supabase Free vacío, correr el §4 y
comprobar que termina en «✅». Borrar el proyecto de prueba al terminar. Registrar acá el resultado:

| Fecha | Resultado |
|---|---|
| _(pendiente: primera prueba real en un segundo proyecto)_ | |

Ensayo previo (2026-09-19, sin tocar producción): `backup.sh` y `restore.sh` contra un Postgres 17 en Docker con
estructura tipo Supabase, y contra MinIO (S3) para subida, verificación y poda. Restauración idéntica (hashes de
contenido, secuencias, trigger de `auth.users`, policies, permisos, buckets y objetos), destino no vacío / producción /
clave equivocada rechazados, y poda que respeta el mínimo y no toca archivos ajenos.

## 8. Rotar la clave de cifrado

Generar otro par (`generar-clave.sh <otra ruta>`), reemplazar `BACKUP_AGE_RECIPIENT`, y **conservar la clave vieja**
mientras existan copias cifradas con ella (30 días como mínimo). Las copias nuevas usan solo la clave nueva.
