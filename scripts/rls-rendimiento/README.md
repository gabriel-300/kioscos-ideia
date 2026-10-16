# Migración 098: rendimiento de RLS

Optimización pura de las policies de RLS de Supabase: **no cambia qué ve ni qué puede hacer ningún rol**, solo cómo se
evalúa. Motivo y detalle técnico: cabecera de `supabase/migrations/098_rls_rendimiento.sql` y `docs/architecture.md` §3 y §9.

| Archivo | Para qué |
|---|---|
| `../../supabase/migrations/098_rls_rendimiento.sql` | La migración (una transacción, `lock_timeout` de 10 s, idempotente). |
| `098_reversion.sql` | Deshace todo: borra las policies nuevas y recrea las 90 originales con su texto exacto (verificado por hash contra la base viva del 2026-09-25). |
| `01_comparar_por_rol.sql` | Compara con RLS **real** lo que ve y puede escribir cada usuario. Se corre antes y después. |
| `02_explain_pos.sql` | `EXPLAIN (ANALYZE)` de la carga del POS como vendedor y como encargado. Antes y después. |
| `03_medir_en_produccion.sql` | Mide el efecto real sobre el tráfico (pg_stat_statements y lecturas de `profiles`) contra la línea base. |

Todo se pega en el **SQL Editor** de Supabase (corre como `postgres`). Ningún script deja datos: las pruebas de escritura
de `01` se deshacen siempre.

## Aplicar

Elegir un momento tranquilo (no en plena hora de venta) y sin cierres/aperturas de caja en curso.

1. **Antes**: pegar `01_comparar_por_rol.sql` completo y ejecutar (~1 minuto). Guardar la salida (captura o CSV): una fila
   por usuario, con la columna `huella`.
2. (Opcional) `02_explain_pos.sql`, bloque 1 y bloque 2 (descomentado): anotar "Execution Time".
3. **Aplicar**: pegar `supabase/migrations/098_rls_rendimiento.sql` completo y ejecutar. Debe terminar sin error
   (si dice `lock timeout`, no se aplicó nada: volver a correrla en otro momento).
4. **Después**, dentro de los 2-3 minutos: volver a correr `01_comparar_por_rol.sql` **sin cambiarlo**. Las columnas `huella`
   tienen que ser **iguales fila por fila**. Si alguna difiere → revertir (abajo) y avisar.
5. Volver a correr `02_explain_pos.sql` y comparar tiempos.
6. Abrir el POS con un usuario vendedor y uno encargado (ver ventas, abrir/cerrar caja) y correr `npm run test:e2e`.
7. Al día siguiente, `03_medir_en_produccion.sql` (o pedírselo a Claude) y `get_advisors` (performance).

## Revertir

Pegar `098_reversion.sql` completo y ejecutar. Es una transacción: queda todo como estaba el 2026-09-25 o no cambia nada.
Sirve tanto si la migración se aplicó completa como si no.

## Lo que se verificó antes de dejarla lista

- Las 96 policies vivas de `public` se extrajeron de `pg_policies` (la base es la fuente de verdad: hay policies sin archivo en el repo).
- Emulación de RLS por MCP (el MCP es de solo lectura y no puede asumir el rol `authenticated`): 10 perfiles (admin,
  encargado, 3 vendedores, 2 concesionarios, repartidor y "sin rol" simulados, anónimo) × 41 tablas × SELECT / INSERT /
  UPDATE (using y check) / DELETE = 2.050 comparaciones, política vieja viva contra política nueva del archivo, con conteo y
  hash de ids: **0 diferencias** (399 de ellas con filas reales).
- Los cinco archivos SQL pasan el parser real de Postgres (libpg-query).
- Lo que **no** se pudo verificar desde Claude: RLS real con `set role authenticated`. Eso es lo que cubre `01_comparar_por_rol.sql`.

## Resultado (2026-10-16): aplicada

Aplicada a mano en el SQL Editor. Verificado después, por MCP y con pruebas de punta a punta:

| Medida | Antes (2026-09-25) | Después (2026-10-16) |
|---|---|---|
| `auth_rls_initplan` (get_advisors, performance) | 45 | **0** |
| `multiple_permissive_policies` | 46 | **1** (`aperturas_caja`, a propósito: ver arriba) |
| Policies en `public` con un helper sin envolver en `(select …)` | — | **0** |
| `npm run test:e2e` (humo contra producción, incluye RLS de `anon`) | 21/21 | **21/21** |
| Lecturas secuenciales de `profiles` | ~590 por minuto (17,9 M en 21 días) | **17 en 77 s** (muestra corta, con las consultas de la propia medición) |

**Nueva línea base para medir el efecto con tráfico real** (tomada el 2026-10-16 18:24:50 UTC, ya con la 098): consulta del POS
(`queryid 6095973185492312135`) con 17.972 llamadas y 15.818.365,9 ms acumulados; `profiles` con 132.083.715 seq_scan. Las
fórmulas de `03_medir_en_produccion.sql` siguen valiendo cambiando las constantes de la línea base (13191 → 17972, 11310400 →
15818365.9, 114129900 → 132083715). Un día de tráfico alcanza para comparar.

**Lo que NO se pudo verificar desde Claude:** que cada rol real ve exactamente lo mismo que antes (el MCP no puede hacer
`set role authenticated`). La emulación previa dio 0 diferencias en 2.050 comparaciones; la prueba real es abrir el POS con un
vendedor y con un encargado (ver ventas, abrir y cerrar caja) y, si se corrió `01_comparar_por_rol.sql` antes de aplicar, repetirlo y
comparar las columnas `huella`. Si algo difiere: `098_reversion.sql`.
