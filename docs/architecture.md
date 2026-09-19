# Arquitectura de kioscos-ideia

POS y administración de kioscos (En Minutas / IDEIA). Maneja plata real: ventas, cajas, cierres, tesorería.
Este documento es para que cualquier sesión nueva, la notebook u OpenCode entienda el sistema sin depender de la
memoria de una PC.

- **Fuente de verdad**: el código y la base viva. Este documento las resume; si contradice al código, gana el código.
- **Última verificación**: 2026-09-19, sobre `master` en `30ea688`, con la base viva (SELECT/GET, solo lectura).
- Lo que no se pudo verificar está marcado **(sin verificar)**.
- Para el negocio (qué hace cada módulo, decisiones que no se corrigen sin preguntar, pendientes): `docs/requirements.md`.
- `AGENTS.md` avisa que este Next.js tiene cambios respecto de lo que conocen los modelos: antes de escribir código de
  Next, leer `node_modules/next/dist/docs/`.

---

## 1. Stack y despliegue

### Stack
| Capa | Tecnología |
|---|---|
| App | Next.js **16.2.12** (App Router), React **19.2.4**, TypeScript |
| Estilos | Tailwind **v4** (`@tailwindcss/postcss`), tokens en `src/app/globals.css` |
| Datos / Auth / Storage | Supabase (Postgres 17, proyecto `quejjgvqpbxgepoxdrli`, `sa-east-1`), `@supabase/ssr` + `@supabase/supabase-js` |
| Validación | `zod` v4 (`import { z } from "zod"`) |
| Excel | `exceljs` (solo `/api/export/movimientos`) |
| Runtime de producción | Cloudflare Workers vía `@opennextjs/cloudflare` (no Pages, no Vercel) |
| Pruebas | `vitest` (unitarias) y `@playwright/test` (humo, solo lectura) |

Dependencias declaradas y **sin uso en `src/`** (verificado con grep de imports): `mercadopago` (el código llama a la API
con `fetch`), `resend`, `date-fns`, `zustand`, `idb`, `leaflet`/`react-leaflet`, `recharts`,
`@turf/boolean-point-in-polygon`, `next-themes`. `@tanstack/react-query` se usa en 1 archivo. `src/lib/openrouter.ts` no
lo importa ningún módulo.

### Despliegue
- **Cada push a `master` despliega** (`.github/workflows/deploy.yml`, también `workflow_dispatch`): Node 22 →
  `npm ci` → `npm run build:cloudflare` → `npx wrangler deploy`.
- **Si el build falla, no se despliega y producción queda en la versión anterior.** `next build` incluye el chequeo de
  tipos; el workflow **no corre `vitest` ni `eslint`**: los tests no son una compuerta de CI hoy.
- URL de producción: `https://kioscos-ideia.lytwyn-ideia.workers.dev` (Worker `kioscos-ideia`, `wrangler.toml`:
  `nodejs_compat`, assets en `.open-next/assets`, sin `[observability]` ni `[triggers]`).
- `middleware.ts` se queda con ese nombre: `proxy.ts` (el nombre nuevo en Next 16) resultó incompatible con
  `@opennextjs/cloudflare` v1.x en su momento.
- Plan de Workers: Paid (subido el 2026-07-04 por errores 1101/503 con el plan gratuito) **(sin verificar hoy)**.

### Variables de entorno y secrets
- **Build (GitHub Secrets)**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (se inlinean en el bundle),
  `CLOUDFLARE_API_TOKEN`.
- **Runtime (secrets del Worker, no se pueden listar desde acá)**: `SUPABASE_SERVICE_ROLE_KEY`,
  `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_USER_ID`, `MERCADOPAGO_WEBHOOK_SECRET`, `GROQ_API_KEY`, `CRON_SECRET`,
  `REPOSICION_API_TOKEN`, `PEDIDOYA_WEBHOOK_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_ACCESS_TOKEN`, `OPENROUTER_API_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`.
  Los de tipo secret deben crearse como **Secret**, no como Plaintext (un `MERCADOPAGO_USER_ID` en Plaintext no se
  aplicaba).
- Estado inferido por las respuestas de producción el 2026-09-19: `CRON_SECRET` cargado (`/api/ping` da 401);
  `REPOSICION_API_TOKEN`, `WHATSAPP_VERIFY_TOKEN` y `PEDIDOYA_WEBHOOK_TOKEN` **sin cargar** (esos endpoints dan 501).
- `.env.example` está desactualizado (lista variables de Evolution API, Correo Argentino y n8n que el código no usa).
- `.env*` y `.mcp.json` **no están versionados** (verificado en el historial). Nunca pegar tokens en comandos ni docs
  (el hook `secret-scanner` bloquea los comandos con tokens).

### Base de datos y migraciones
- Las migraciones (`supabase/migrations/000…095`, 101 archivos con `999_seed_demo.sql`, que **no** se corre en
  producción) **se aplican a mano en el SQL Editor** de Supabase, no por CLI. **No hay staging**: la base es de
  producción. Hay números repetidos (029, 042, 044, 063 tienen dos archivos).
- La tabla de registro de migraciones de Supabase tiene 58 entradas y **no es fiable** para saber qué está aplicado;
  además hay ~14 migraciones registradas sin archivo en el repo y policies vivas sin archivo (categories, products,
  profiles), la tabla `cta_corriente_pagos` sin `CREATE` y el bucket `remitos` sin migración. **Repetir las migraciones
  no reconstruye la base viva.** Estado verificado el 2026-09-19: 000–095 aplicadas (la 095 la corrió el usuario).
- Antes de cambiar la firma de un RPC hay que hacer `DROP FUNCTION` explícito (ver §9).
- **Backups**: la organización de Supabase está en plan **Free, con 0 backups y sin PITR**. No hay copia restaurable.
- Tipos: `src/types/database.ts` está parchado a mano (`supabase gen types` se cuelga con segfault en esta máquina
  Windows/Node 24); por eso el código usa mucho `(supabase as any)` (ver §9).

### Comandos
```
npm run dev                  # desarrollo
npm run build                # next build (con chequeo de tipos)
npm run build:cloudflare     # build para Workers (lo que corre el CI)
npm run preview:cloudflare
npm test                     # vitest run: 9 archivos, 103 tests (verificado 2026-09-19)
npm run test:e2e             # Playwright de humo, SOLO LECTURA, contra producción por defecto
                             # (E2E_BASE_URL=http://localhost:3000 para probar local)
```

### Hook pre-push
`scripts/git-hooks/pre-push` corre `npx tsc --noEmit` y cancela el push si hay errores de tipos (ignora `.next/`).
Motivo: el 18/09 un error de tipos rompió el deploy de `master`.
Los hooks de `.git` no viajan con el repo: **en cada copia (ej. la notebook) correr `sh scripts/instalar-hooks.sh`**.
Saltearlo en una emergencia: `git push --no-verify`. `.gitattributes` fuerza LF en scripts y hooks (con CRLF fallan
en otra máquina).

### Herramientas de desarrollo con Claude Code
Hooks en `.claude/` (secret-scanner sobre Bash, bloqueo de escritura en `.env*`). El MCP de Supabase está en **solo
lectura** (`--read-only`, decisión del usuario del 2026-09-19); las migraciones las corre el usuario, o Claude con la
Management API solo si el usuario lo confirma cada vez. El repo lo tocan varias sesiones en paralelo: commitear solo
con rutas explícitas (nunca `git add -A`) y no pushear sin aprobación.

---

## 2. Estructura de `src/`

```
src/
  middleware.ts                    matcher global; delega en lib/supabase/middleware.ts (contención por rol)
  app/
    layout.tsx, page.tsx, globals.css
    (auth)/                        login, forgot-password, pendiente, registro (redirige a /login), registro-mayorista
    auth/                          callback (verifyOtp), redirect (destino por rol), set-password
    (admin)/
      layout.tsx                   barra de navegación, badges de pendientes; NO es una barrera de seguridad (§4)
      admin/<módulo>/              page.tsx (Server Component) + actions.ts ("use server") + _components/ (cliente)
        34 módulos: alertas-precio, auditoria, ayuda, categorias, cierres, conciliacion-mercadopago, cta-corriente,
        dashboard, gastos, informe-mensual, mermas, movimientos, nichos, pagos-proveedores, pedidos-online
        (+configuracion), pedidoya, productos, promociones, pronostico, proveedores, repartos, reposicion,
        rotacion-productos, socios, staff, stock, sucursales (+[id] con apertura/cierre/traspaso/transferencia/
        auditoría/mercadopago/precios/cta-corriente/pagos-proveedores/socios), termos, tesoreria, transferencias,
        ventas, ventas-diarias, ventas-por-horario, ventas-por-vendedor
    pedir/[sucursal]/              storefront público (catálogo, carrito, checkout), sin sesión
    api/
      auth/registro                410 (deshabilitado el 2026-09-19)
      export/movimientos           Excel, solo admin
      ping                         keep-alive con CRON_SECRET (falla cerrado si falta)
      reposicion-hoy               GET con Bearer REPOSICION_API_TOKEN (para n8n)
      webhooks/{mercadopago,pedidoya,whatsapp}
  lib/
    auth/        require-role.ts, sucursal-access.ts, turno-actual.ts
    supabase/    server.ts (createClient / createAdminClient), client.ts (navegador), middleware.ts, paginar.ts (fetchAll)
    pedidos/     crear-pedido-publico, pricing, stock, rate-limit, horario, transiciones, crear-venta-publica,
                 bot-whatsapp, interpretar-pedido-ia, sugerir-upsell, validaciones, actions ("use server")
    whatsapp/    enviar-mensaje (Graph API, gateado por WHATSAPP_ACCESS_TOKEN)
    fecha.ts     helpers de fecha en UTC-3 (fechaHoyAR, fmt*)
    groq.ts      lectura de remitos/facturas por foto
    reposicion.ts, utils.ts, openrouter.ts (sin uso)
  components/    admin/ (admin-nav, number-input-wheel-guard), auth/, ui/ (badge, button, combobox, input, skeleton)
  types/database.ts
tests/           unit/ (vitest) y helpers/fake-supabase.ts (doble en memoria del cliente de Supabase)
e2e/             smoke.spec.ts (Playwright, solo lectura)
supabase/migrations/
scripts/         instalar-hooks.sh, git-hooks/pre-push
.github/workflows/deploy.yml
docs/            este documento y requirements.md
```

Convención por módulo: `page.tsx` es Server Component (trae datos y **chequea el rol**); `actions.ts` exporta Server
Actions que devuelven `{ error? }` en vez de lanzar (ver §9); `_components/` tiene los Client Components.

---

## 3. Acceso a datos

Hay dos clientes de Supabase (`src/lib/supabase/server.ts`):

| | `createClient()` | `createAdminClient()` |
|---|---|---|
| Credencial | anon key + cookies de la sesión del usuario | `SUPABASE_SERVICE_ROLE_KEY` |
| RLS | **Se aplica** | **No protege nada** |
| Uso | leer con los permisos del usuario, `auth.getUser()` | casi toda la escritura y muchas lecturas (85 archivos) |

**Con `createAdminClient()` el chequeo de rol y de sucursal es responsabilidad del código.** Patrón que se sigue en
cada Server Action:

1. `const { userId, role } = await requireStaff()` (o `requireAdmin()` / `requireRepartidor()`).
2. Si el rol no puede hacer la acción, `return { error }`.
3. `requireSucursalAccess(admin, userId, role, sucursalId)`: encargado/concesionario deben ser
   `sucursales.encargado_user_id`; vendedor debe estar en `profile_sucursales`; admin pasa.
4. **El `sucursalId` que se valida tiene que salir del registro que se va a tocar, no de un parámetro del cliente.**
   Buenos ejemplos: `alertas-precio`, `pedidos-online`, `mercadopago-actions`. El caso contrario (validar una sucursal
   que manda el cliente y luego actuar sobre un id suelto) fue el bug de `termos/actions.ts` corregido el 2026-09-19.
5. Recalcular en el servidor todo lo que sea plata (precio, totales, medios de pago del cierre); nunca confiar en
   lo que manda el cliente.
6. Toda escritura filtra por `id` **y** `sucursal_id`; nunca hacer `.update({ ...data })` con el objeto del cliente
   (mass-assignment: `nichos/actions.ts:67` permite que un encargado habilite Cta. Corriente; ver §10).
7. Devolver `{ error }` (no lanzar) y `revalidatePath(...)`.

**Lecturas**: cada `page.tsx` verifica el rol y, para encargado/vendedor/concesionario, la sucursal. Las consultas
que pueden superar 1.000 filas usan `fetchAll` (`src/lib/supabase/paginar.ts`, ordena por una clave única y pide por
páginas con `.range()`).

**RLS y permisos en la base (verificado el 2026-09-19)**
- RLS habilitado en las 42 tablas de `public`, más la vista `stock_sucursal` con `security_invoker`.
- Helpers usados por las policies: `is_admin()` y `current_role()` leen el rol del JWT (`app_metadata.role`),
  `my_sucursal_id()` lee `profiles.sucursal_id`, `movimiento_visible_por_turno(...)` restringe a vendedor/encargado a
  lo de su turno del día (fecha calculada en `America/Argentina/Buenos_Aires`).
- Permisos por columna: `products.costo` y `margen_*` no son legibles por `anon` ni `authenticated`
  (`select("*")` sobre `products` con la anon key da **401** `42501`); `profiles.role/sucursal_id/es_socio/
  credito_limite` no son actualizables por `authenticated`.
- Los RPC de dinero (`crear_movimiento_con_items`, `abrir_caja`, `cerrar_caja`, transferencias, traspaso, termos) solo
  los ejecuta `service_role`.
- Storage: `remitos` y `product-images` son buckets públicos (las URLs directas se ven sin sesión). Desde la
  migración 095 no se puede **listar** con la anon key, subir a `remitos` exige rol de staff y borrar exige admin,
  y `product-images` solo lo escribe admin. Falta la fase 2 (bucket privado + URLs firmadas).
- El JWT cachea el rol hasta 1 hora: las policies ven un rol viejo ese tiempo; las Server Actions usan
  `auth.getUser()` y no.

---

## 4. Autenticación y roles

**El rol vive en `auth.users.app_metadata.role`** (no en `profiles`): `admin`, `encargado`, `vendedor`,
`concesionario`, `repartidor`. `profiles.role` (enum `user_role`: `customer_b2c`, `admin_enminutas`…) es letra muerta
de otra app que comparte proyecto: **no usarla**. `profiles.es_socio` es una marca ortogonal al rol (el menú arma un
rol sintético "socio").

**Alcance por sucursal**
- `encargado` y `concesionario`: una sola sucursal, la que tiene `sucursales.encargado_user_id = su id`.
- `vendedor`: `profile_sucursales` (puede estar en varias, migración 082); `profiles.sucursal_id` es la sucursal activa.
- `admin`: todas. `repartidor`: ninguna, solo su cola de entregas.

**Guardas de servidor** (`src/lib/auth/require-role.ts`)
- `requireAdmin()`: solo `admin`.
- `requireStaff()`: `admin`, `encargado`, `vendedor`, `concesionario` (**no** incluye `repartidor`, a propósito).
- `requireRepartidor()`: `repartidor` o `admin` (solo las acciones de `/admin/repartos`).
- Ojo: el archivo empieza con `"use server"`, así que esas tres funciones quedan expuestas como Server Actions
  invocables (solo devuelven el id y el rol del que llama; no tiene impacto pero conviene sacar la directiva).

**`middleware.ts`** (`src/lib/supabase/middleware.ts`): en cada request llama a `auth.getUser()` (valida contra
Supabase).
- `/admin/*` exige un rol de `STAFF_ROLES`; si no, redirige a `/login`.
- `ADMIN_ONLY_PREFIXES` (bloqueados para encargado, vendedor y concesionario): `/admin/categorias`, `/admin/staff`,
  `/admin/movimientos`, `/admin/productos`, `/admin/pedidos-online/configuracion`.
- `VENDEDOR_BLOCKED_PREFIXES`: `/admin/pronostico`.
- **Repartidor**: confinado a `/admin/repartos` (lista de una sola ruta; cualquier otra ruta o el destino por defecto lo
  manda ahí). El resto del admin nunca se auditó pensando en ese rol.
- Un usuario de staff logueado que entra a una página pública es redirigido a su panel, salvo `/auth`, `/login`,
  `/admin`, `/api` y `/pedir` (el admin tiene que poder mirar el storefront).
- Si algo falla en el `try`, **deja pasar** ("las páginas hacen su propio chequeo").

**Layout de `(admin)`**: redirige a `/login` si no hay usuario o rol de staff y calcula los badges del menú. **No es una
barrera de seguridad**: en el App Router un layout no se vuelve a ejecutar en cada navegación del cliente. Tampoco lo es
el middleware por sí solo: **las Server Actions llegan por POST y cada una se protege a sí misma** (los ids de acción
están en los bundles públicos de `_next/static`). Por eso `requireStaff()` + `requireSucursalAccess()` van en cada acción,
y cada `page.tsx` verifica el rol.

**Alta de usuarios**: solo desde `/admin/staff` (`crearStaff`, requiere admin, crea con email confirmado).
`/api/auth/registro` devuelve 410 y `/registro` redirige a `/login`. El signup de Supabase Auth está abierto
(`disable_signup = false`): una cuenta sin rol no entra al admin, pero es una cuenta `authenticated` (por eso las
policies de Storage exigen rol de staff).

**Flujos**: `/auth/redirect` decide el destino por rol (agregar un rol nuevo exige tocarlo: el repartidor entró en un
bucle a `/login` hasta que se corrigió); `/auth/callback` verifica el token y redirige a `next` **sin validarlo** (open
redirect, ver §10); `/auth/set-password`.

---

## 5. Modelo de datos por dominio

42 tablas en `public` (verificado). Los nombres son los reales.

| Dominio | Tablas |
|---|---|
| **Catálogo y precios** | `products`, `categories`, `product_prices` (precio y costo **por sucursal**, más `punto_minimo/pedido/maximo`), `product_price_history`, `promos`, `promo_items`, `promo_prices` (por sucursal), `proveedores`, `alertas_precio` |
| **Operación y stock** | `sucursales`, `movimientos`, `movimiento_items`, vista `stock_sucursal`, `transferencias_stock`, `transferencia_items`, `auditorias_stock`, `auditoria_stock_items`, `termos`, `prestamos_termo`, `reposicion_marcas_pedido` |
| **Caja y turnos** | `aperturas_caja`, `cierres_caja`, `retiros_caja`, `traspasos_caja` |
| **Tesorería** | `gastos`, `gastos_fijos`, `pagos_proveedor`, `movimientos_socio`, `pagos_socio`, `cta_corriente_pagos` |
| **Usuarios y CRM** | `profiles`, `profile_sucursales`, `contactos_crm`, `nichos`, `platform_settings` (restos del proyecto Minutas) |
| **Pedidos online** | `pedidos`, `pedido_items`, `zonas_entrega`, `pedido_rate_limits` |
| **Integraciones** | `mercadopago_qr_orders`, `mercadopago_transferencias_recibidas`, `pedidoya_webhook_events`, `whatsapp_webhook_events` |

Reglas del modelo que hay que conocer
- `movimientos.tipo` (CHECK): `entrega`, `devolucion`, `ajuste`, `venta`, `merma`, `transferencia_salida`,
  `transferencia_entrada`. `movimientos.canal` es **texto libre** sin CHECK: `consumidor_final`, `pedido_ya_efectivo`,
  `pedido_ya_plataforma`, `cuenta_corriente`, `ambulante`, `ronda_comunidad`, `multa_termo`, `pedido_online`.
- **El stock no se guarda**: `stock_sucursal` lo deriva de los movimientos (entrega/ajuste suman; devolución/venta/merma
  restan; los anulados no cuentan; las transferencias tienen su propio par de movimientos).
- Anular es soft: `anulado_en` + `anulado_por` + `motivo_anulacion` en `movimientos` (y `anulada_en` en
  `transferencias_stock`). Excluye la venta de stock, caja e informes pero queda en el historial.
- `cierres_caja.diferencia` es una **columna generada** (fórmula en §6). `aperturas_caja` no tiene UNIQUE por día
  (multi-turno: se puede abrir y cerrar varias veces al día).
- `cta_corriente_pagos` tiene `personal_id` o `contacto_id` (CHECK XOR): fiado a personal interno o a un contacto
  externo habilitado.
- `pedidos.estado` (CHECK): `carrito`, `pendiente_pago`, `confirmado`, `pagado`, `en_preparacion`, `listo_retiro`,
  `en_reparto`, `entregado`, `cancelado`, `expirado`. La constraint `pedidos_direccion_entrega_delivery` es `NOT VALID`
  a propósito.
- Montos de tesorería con CHECK en la base (`monto_efectivo >= 0`, `monto_billetera >= 0`, suma `> 0`).
- `created_by` en las tablas de operación identifica quién creó cada fila (ver requisitos no funcionales).

### RPC críticas (15 funciones en `public`, todas con `search_path` fijo)

**`crear_movimiento_con_items`** (16 parámetros; `SECURITY DEFINER`; migración 086 es la última definición)
- Inserta el movimiento y sus ítems en una transacción.
- Si es `venta` con canal `cuenta_corriente`: valida el límite de crédito con `pg_advisory_xact_lock` por persona o
  contacto (a un contacto externo también exige `habilitado_cta_corriente`).
- Si es `venta`: por cada producto con `merma_coccion_pct` genera **en la misma transacción** un movimiento de `merma`
  (`cantidad × pct / (1 − pct)`).
- Toma un lock por (sucursal, producto). El chequeo de stock negativo está **comentado** (`DESACTIVADO TEMPORALMENTE`
  desde la migración 024, a propósito).
- **No** valida que los pagos sumen el total, ni categorías/canales habilitados, ni que haya caja abierta, ni es
  idempotente. Esas validaciones viven en `crearMovimiento` (o faltan: ver §10).

**`abrir_caja` / `cerrar_caja`** (lock por sucursal)
- `abrir_caja` falla si ya hay una caja abierta.
- `cerrar_caja(13 parámetros)` falla si no hay apertura o ya está cerrada, suma en el servidor `retiros_turno`,
  `pagos_ctc_turno`, `pagos_proveedor_turno`, `retiros_socio_turno` y `pagos_socio_turno` desde la última apertura,
  exige nota si la diferencia ≠ 0 y asigna `numero_liquidacion`. Los totales de ventas y medios de pago **llegan por
  parámetro** (los calcula `cerrarCaja` antes de llamar).

**`registrar_traspaso_caja`**: cambio de persona con la caja abierta; calcula el efectivo esperado, registra quién
entrega y quién recibe y exige nota si hay diferencia.

**`enviar_transferencia_stock` / `confirmar_transferencia_stock`**: sacan del origen al enviar y suman en el destino
lo que se confirma como recibido. `confirmar` **no bloquea la fila** de la transferencia (riesgo de doble confirmación,
§10).

**`prestar_termo` / `devolver_termo`**: préstamo de termos; bloquea si el DNI tiene una multa impaga en cualquier
sucursal; la multa es `ceil(horas de atraso) × tarifa` con horas de gracia por sucursal.

**Helpers de RLS**: `is_admin`, `current_role`, `my_sucursal_id`, `movimiento_visible_por_turno`. También hay
`handle_new_user` (crea el `profile` al dar de alta un usuario), `set_updated_at` y `rls_auto_enable`.

---

## 6. Flujos de dinero, paso a paso

Regla general: **el precio nunca se confía del cliente**; el servidor lo resuelve desde `product_prices` (o
`promo_prices`) de la sucursal.

### Venta (POS, `crearMovimiento`)
1. `requireStaff()` y `requireSucursalAccess()`. Solo admin hace ajustes; el vendedor no carga entregas.
2. Un vendedor solo vende si es el **tenedor actual** de la caja (quien abrió el turno o quien lo recibió por
   traspaso); si no: "tocá Traspaso de turno antes de vender".
3. Precio por línea = `product_prices.precio_dist` de la sucursal. Excepción: en canales Pedido Ya se acepta un precio del
   cliente si es **mayor o igual** al de catálogo. Si el producto no tiene fila de precio en la sucursal, hoy se acepta
   el del cliente (hallazgo H-08).
4. Promos/recetas: se expanden a sus componentes y el precio de la promo se reparte **proporcional al costo** de cada
   componente (el último absorbe el resto del redondeo). Todo se redondea a centavos con `redondearMoneda`.
5. Canales `cuenta_corriente` y `pedido_ya_plataforma`: se descartan los medios de pago (no se cobra en el momento).
   `pedido_ya_efectivo`: todo el total va a efectivo. Descuento de Pedido Ya: se reparte proporcional entre las líneas.
6. Validación de sobrepago: billetera + tarjeta + transferencia no puede superar el total (el efectivo sí: es vuelto).
7. RPC `crear_movimiento_con_items` (ver §5). Después, si es entrega, se genera la alerta de precio cuando el costo cambió.
8. Sin idempotencia: un doble envío crea dos ventas.

### Apertura de caja
`abrirCaja` → RPC `abrir_caja` (lock por sucursal, `fondo_inicial`). Falla si ya hay una caja abierta.

### Cierre de caja (`cerrarCaja`)
1. Para `encargado`/`vendedor`/`concesionario`, el servidor **ignora** los totales del cliente y recalcula desde los
   `movimientos` del turno (creados desde la última apertura, no anulados): `total_ventas`, `total_fiado`,
   `total_plataforma`, billetera/tarjeta/transferencia y `fondo_inicial`. El admin puede mandar sus números.
   Las ventas `cuenta_corriente` y `pedido_ya_plataforma` no entran al total conciliado.
2. Un vendedor solo cierra el turno que tiene en custodia.
3. Si la sucursal tiene `auditoria_obligatoria`, se exige la auditoría del turno.
4. RPC `cerrar_caja` suma retiros y pagos del turno y guarda el cierre. Fórmula (columna generada
   `cierres_caja.diferencia`, idéntica a la del RPC):
   ```
   diferencia = (efectivo_declarado − fondo_inicial + retiros_turno + retiros_socio + pagos_a_proveedor
                 − pagos_cta_cte − devoluciones_de_socio)
                + billetera + tarjeta + transferencia − total_ventas
   ```
5. Diferencia ≠ 0 exige nota. El cálculo de los totales ocurre **antes** de la transacción del RPC (§10).

### Traspaso de turno
Cambia la persona sin cerrar la caja: `registrarTraspaso` → RPC `registrar_traspaso_caja`. El que recibe declara el
efectivo real; queda el registro (esperado, real, diferencia). No toca `aperturas_caja` ni `cierres_caja`. Cerrar y
abrir sigue existiendo para el fin del día; **no** se bloquea el botón de cerrar por rol (decisión: fricción con aviso
en vez de bloqueo).

### Retiro de efectivo y sobre
- `registrarRetiro` guarda un retiro del turno (`retiros_caja`, con comprobante opcional en Storage).
- **Sobre** = `efectivo_declarado − fondo_siguiente` de cada cierre. `confirmarRetiroSobre` (admin) lo confirma quien
  retira, con **su** sesión (nadie confirma por otro). `verificarSobre` (admin) carga cuánto contó quien lo recibe.
  Se ve en `/admin/cierres`.

### Tesorería (`/admin/tesoreria`, admin o socio)
```
Posición = efectivo en cajones + sobres pendientes − deuda a proveedores − deuda a socios
```
- Efectivo en cajones: `fondo_inicial` si el turno está abierto, `fondo_siguiente` si está cerrado.
- Deuda a proveedores: por proveedor, entregas con `proveedor_id` menos `pagos_proveedor`, **con piso en 0**.
- Deuda a socios: solo `movimientos_socio.tipo = 'retiro_temporal'` menos `pagos_socio`; `retiro_ganancias` no es deuda.
- La Cta. Corriente pendiente se muestra aparte (no entra a la fórmula).
- A la conciliación del cierre entran solo los montos en **efectivo** de pagos a proveedor, Cta. Cte. y socios; la
  billetera es informativa.
- Gastos (`/admin/gastos`, admin): `gastos` reales y `gastos_fijos` presupuestados; "marcar pagado" inserta el gasto real
  vinculado. Sueldos con `empleado_id` y `tipo_sueldo` (`regular`/`extra`).

### Cuenta corriente
Personal interno (`profiles.credito_limite`) y contactos externos (`contactos_crm.habilitado_cta_corriente` +
`limite_credito`, los habilita un admin). El límite se valida **dentro del RPC** con lock. Los pagos
(`cta_corriente_pagos`, efectivo y/o billetera) bajan el saldo; el pago en efectivo entra a la conciliación del turno.

### Anulaciones
- **Venta**: cualquier staff con acceso a la sucursal, solo mientras la caja de ese turno sigue abierta, con motivo
  obligatorio. No anula la merma automática que generó (queda vigente: hallazgo H-14).
- **Transferencia**: solo admin; marca `anulada_en` en los movimientos de salida y de entrada.
- `eliminarMovimiento` (admin) borra físicamente, sin registro ni chequeo de turno cerrado.

### Transferencia de stock entre sucursales
`enviarTransferencia` (staff del origen): el stock sale del origen. `confirmarTransferencia` (staff del destino): el
destino suma **solo lo recibido**; la diferencia queda registrada. `anularTransferencia`: admin.

### Cobro con QR de Mercado Pago (mostrador)
El vendedor genera un QR con el monto (`armarQrMercadoPago`), la pantalla consulta cada 3 s; cuando entra el pago
(webhook o consulta) suena un aviso y **el vendedor confirma la venta con un clic** (no se auto-confirma). La orden queda
en `mercadopago_qr_orders` y se vincula a la venta (`vincularMovimientoQr`, exige sucursal y monto exactos). Los pagos
que no matchean ninguna orden pendiente van a `mercadopago_transferencias_recibidas` ("pagos sin conciliar").

### Termos
`prestar_termo` (DNI y teléfono obligatorios), `devolver_termo` calcula la multa, `pagarMultaTermo` la cobra como una
venta normal contra el producto de servicio `MULTA-TERMO` (canal `multa_termo`).

---

## 7. Pedidos online (storefront público)

**Flujo público** (`/pedir/[sucursal]`, sin sesión): catálogo (respeta `categorias_habilitadas`, `promos_habilitadas`,
`vendible_pos` y oculta los productos sin precio en la sucursal) → carrito (persistente en el navegador) → checkout
(retiro o envío por zona, datos, medio de pago) → `iniciarPedido` → confirmación. `consultarEstadoPedidoPublico` refresca
el estado.

**El servidor recalcula todo** (`src/lib/pedidos/crear-pedido-publico.ts`): el tipo de entrada **no lleva precio**;
`resolverItemsPedido` toma los precios de `product_prices`/`promo_prices` de la sucursal, revalida categorías, promos y
activo; `chequearStockLiviano` avisa si falta stock (no es atómico); el costo de envío sale de `zonas_entrega`
(nunca del cliente); el mínimo de envío se compara con el subtotal calculado. Rate limit: 5 pedidos por 10 minutos por IP
(`cf-connecting-ip`) en `pedido_rate_limits`.

**Medios de pago**
- **Efectivo**: el pedido queda `confirmado` (cobro en la puerta) y **la venta se registra recién al pasar a
  `entregado`** (`registrarVentaCobroEnEntrega`).
- **Mercado Pago por link**: `pendiente_pago` con vencimiento a las 2 horas; el local manda el link por WhatsApp y un
  admin/encargado confirma el pago a mano (`confirmarPagoRecibido` → `crearVentaPublica`).
- **"Cobro primero, venta después"**: `crearVentaPublica` pasa el pedido de `pendiente_pago` a `pagado` con un update
  condicional (una sola vez) y recién entonces crea la venta con `crear_movimiento_con_items` (`canal = pedido_online`,
  `pago_billetera = total`). El webhook de Mercado Pago la dispara cuando una orden de QR con `pedido_id` pasa a
  `pagado`; **hoy el storefront no genera esas órdenes** (el armado automático del QR del storefront no se conectó)
  **(sin verificar en producción)**.

**Máquina de estados** (`src/lib/pedidos/transiciones.ts`, cada paso con update condicional al estado leído):
```
confirmado | pagado ──▶ en_preparacion ──▶ retiro:   listo_retiro ──▶ entregado
                                        └─▶ delivery: en_reparto (exige repartidor asignado) ──▶ entregado
pendiente_pago ──▶ pagado (confirmarPagoRecibido / webhook)      cualquiera sin venta ──▶ cancelado (staff)
pendiente_pago vencido ──▶ expirado (se marca al consultar el estado, sin cron)
```
Quién: staff con acceso a la sucursal avanza estados; admin/encargado asignan repartidor y confirman pagos; el
repartidor solo marca `entregado` sus pedidos en `en_reparto` (`/admin/repartos`); la configuración (zonas, horario,
delivery, mínimo) es solo admin.

**Horario**: `sucursales.horario_pedidos` (UTC-3 fijo, sin horario de verano). Sin horario cargado = siempre abierto. Se
valida en pantalla, **no en el servidor** (H-12).

**Bot de WhatsApp** (`lib/pedidos/bot-whatsapp.ts`): menú por botones y, para texto libre, Groq como atajo (nunca escribe
ítems: arma una propuesta que el cliente confirma). Solo actúa en sucursales con `mercadopago_pos_id` cargado y con
`WHATSAPP_ACCESS_TOKEN`; hoy está inerte (0 eventos).

**Estado real al 2026-09-19**: `pedidos_online_habilitado = true` en Parque de las Fiestas y UNAM, sin horario, sin
zonas (`zonas_entrega` vacía) y con `delivery_habilitado = false`: hoy solo se puede retirar. Hay 1 pedido de prueba.
Latente antes de habilitar delivery: el envío no es un ítem pero sí entra a los pagos (H-05), la venta online se fecha en
UTC (H-13) y queda con `created_by` nulo.

---

## 8. Integraciones y su estado real

| Integración | Dónde | Estado (2026-09-19) |
|---|---|---|
| **Mercado Pago, QR del mostrador** | `sucursales/[id]/mercadopago-actions.ts`, `/api/webhooks/mercadopago`, migraciones 071/072 | **Producción**: 3.338 QR pagados, el último hoy. Secrets `MERCADOPAGO_*` del Worker. El webhook no exige firma (Mercado Pago no permite validarla en QR): la seguridad es re-consultar el pago a la API con nuestro token. |
| **Mercado Pago, storefront** | `pedidos-online/actions.ts` | Solo link + confirmación manual. Sin armado automático. |
| **PedidoYa** | `/api/webhooks/pedidoya`, `pedidoya_webhook_events` | Endpoint responde 501 sin `PEDIDOYA_WEBHOOK_TOKEN`; 0 eventos; no arma ventas (falta ver un payload real). |
| **WhatsApp Cloud API** | `/api/webhooks/whatsapp`, `lib/whatsapp/` | 501 sin `WHATSAPP_VERIFY_TOKEN`/`WHATSAPP_APP_SECRET`; 0 eventos. Falta el alta en Meta Business Manager. Cuando esté activo, registra cada mensaje como contacto (firma HMAC verificada, dedupe por `wa_message_id`). |
| **n8n** | `GET /api/reposicion-hoy` | 501 sin `REPOSICION_API_TOKEN`; el workflow de n8n no está armado. Solo hay 6 puntos de pedido cargados y 2 productos con proveedor. |
| **Groq** | `src/lib/groq.ts`, `lib/pedidos/*` | Modelo `qwen/qwen3.6-27b`. Lee remitos/facturas por foto (`leerRemito`, con `validarComprobante`), interpreta texto libre del bot y sugiere un producto extra en el checkout. Límite de la cuenta 8.000 tokens/min compartido entre esos usos. |
| **OpenRouter** | `src/lib/openrouter.ts` | Código sin uso: ningún módulo lo importa. |
| **Resend** | (sin uso en código) | La dependencia y `RESEND_API_KEY` locales existen pero **ningún archivo de `src/` la importa**. El SMTP de Supabase Auth **no está configurado** (`smtp_host` nulo): los mails de recuperación salen del servicio integrado de Supabase, limitado a 2 por hora. |
| **Supabase Storage** | buckets `remitos`, `product-images` | Ver §3. |

Sin integración de facturación electrónica (AFIP/ARCA): no hay nada en el código; decisión del usuario de pausarlo.

---

## 9. Trampas conocidas

1. **Límite de 1.000 filas de PostgREST.** `max_rows = 1000` (confirmado por la Management API). Una consulta sin `.range()`
   se corta en silencio, sin error. Ya causó informes con una fracción de las ventas. Usar `fetchAll` o agregar en SQL.
   Volumen: ~5.000 ventas por mes, 22.800 ítems, 15.800 movimientos.
2. **`"use server"` solo exporta funciones `async`.** Una constante, un tipo con valor o una función síncrona exportada
   rompe el build. Por eso `redondearMoneda` está copiada en `pricing.ts`.
3. **Next.js oculta el mensaje de un `throw` en una Server Action en producción** (queda un "digest" genérico).
   Devolver `{ error }` en las acciones nuevas (varias acciones viejas todavía lanzan).
4. **UTC vs UTC-3.** La base guarda `timestamptz` en UTC, el Worker corre en UTC y el negocio vive en UTC-3 (sin horario
   de verano). Para "hoy" usar `fechaHoyAR()` (`src/lib/fecha.ts`); **nunca** `new Date().toISOString().slice(0, 10)`
   (entre las 21:00 y las 24:00 da el día siguiente). Las ventas online todavía tienen ese bug (H-13).
5. **`globals.css` fuerza color y fuente en `h1`–`h4`.** El catálogo público va dentro de la clase `.pd`, que los resetea;
   un título nuevo fuera de `.pd` hereda el estilo del admin.
6. **`html, body { overflow-x: hidden }` rompe `position: sticky`.** El catálogo usa `overflow-x: clip` con
   `html:has(.pd)` (línea 265 de `globals.css`).
7. **`(supabase as any)`**: 389 usos en 85 archivos. Apaga la verificación de columnas y de tipos: así pasó inadvertido el
   mass-assignment de `nichos`. En tablas de dinero, tipar.
8. **Overloads duplicados de RPC.** Cambiar la firma de una función con `create or replace` **agrega** un overload y
   deja el viejo; hay que hacer `drop function if exists ...(tipos)` antes (incidente de la migración 028, repetido en la
   085). Checklist: buscar todos los llamadores del RPC antes de cambiarlo y verificar en `pg_proc` que queda uno solo.
9. **`select("*")` con columnas sin permiso.** Como `products.costo` no es legible por el rol de sesión, un
   `select("*")` con el cliente de sesión falla o devuelve 0 filas; usar el cliente admin o listar columnas.
10. **El cliente admin no aplica RLS**, y un `update`/`delete` filtrado solo por `id` toca filas de otras sucursales.
11. **`npm i --no-save` poda** los paquetes que no están en `package.json` (borró un Playwright instalado a mano). Declarar
    en `package.json` lo que se use.
12. **Cookies de sesión armadas a mano** no sirven para probar Server Components con curl; usar Playwright con login real.
13. **`aperturas_caja` sin UNIQUE** es intencional (multi-turno); la unicidad de "caja abierta" la da el lock de `abrir_caja`.
14. **Ninguna venta puede quedar fuera de un turno**: hoy lo garantiza la pantalla (0 casos en la historia) y no el servidor.
15. **No hay staging.** Toda prueba con escritura corre contra producción: crear datos de prueba, **borrarlos** (incluida la
    merma automática que genera cada venta) y solo entonces avisar.

---

## 10. Deuda técnica y riesgos abiertos

Resumen de la auditoría del 2026-09-19 (informe completo, con archivo:línea y escenarios:
https://claude.ai/artifact/XVUPwuWmUiTWvkyXkk6QHf; hay otra auditoría paralela del mismo día:
https://claude.ai/artifact/PHtFCoqfMmhD4SWFPiifb4). Estado verificado después de los commits `af51edf`, `d7fb2d0` y
`30ea688` y de la migración 095.

**Corregido y en producción**
- Registro público (410), `/api/ping` falla cerrado (y `CRON_SECRET` ya está cargado), listado anónimo de `remitos`
  cerrado y escritura de Storage restringida (095).
- Paginación con `fetchAll` en informe mensual, gastos, exportación Excel, conciliación de Mercado Pago y análisis del mes
  del detalle de sucursal.
- Termos (filtro por sucursal, multa atómica), cancelación de QR condicional y pagos sobre órdenes canceladas.
- Base de pruebas: 103 tests unitarios y un smoke E2E de solo lectura.

**Abierto (ordenado por gravedad)**
| ID | Sev. | Riesgo |
|---|---|---|
| H-03 | Alta | **Sin backups** (plan Free). |
| H-04 | Alta | `next` 16.2.12: los avisos críticos piden 16.3.3 o más (sugerido 16.3.5). No son explotables en Workers, pero conviene subir. No usar `npm audit fix --force`. |
| H-02 | Alta (parcial) | Siguen sin paginar: pronóstico (`pronostico/page.tsx:71`), tarjetas "Entregado/Devuelto" del detalle de sucursal, `lib/reposicion.ts` y el layout (latentes). |
| H-05 | Alta (latente) | Delivery: el envío entra a los pagos pero no a los ítems (cierres con diferencia falsa) y el efectivo del repartidor cuenta como caja del local. Resolver antes de habilitar delivery. |
| H-23 | Media | 142 cobros QR pagados sin venta vinculada ($733.980; 48 desde el 10/08 = $258.105). |
| H-06 | Media | `confirmar_transferencia_stock` sin bloqueo de fila: doble confirmación duplica el stock. |
| H-07 | Media | `nichos/actions.ts:67` (`...data`): un encargado puede habilitar Cta. Corriente y fijar su límite. |
| H-08 | Media | Categorías, canales y promos habilitados por sucursal solo se validan en pantalla; precio del cliente aceptado si falta el precio de sucursal. |
| H-09 | Media | Sin idempotencia en ventas (5 pares idénticos en <10 s). |
| H-10 | Media | El cierre calcula los totales fuera de la transacción del RPC. |
| H-11 | Media | Webhook de Mercado Pago: `data.id` sin validar, monto no comparado, errores devuelven 200. |
| H-12 | Media | Storefront: sugerencia de IA sin límite, pedidos en efectivo sin verificación, horario solo en pantalla, cantidades sin tope. |
| H-13 | Media (latente) | Ventas online con fecha UTC y `created_by` nulo. |
| H-14 | Media | Anular venta no anula su merma automática; borrado y edición de fecha sin rastro. |
| H-15 | Media | El repo no reconstruye la base (migraciones sin archivo, policies sin archivo). |
| H-24 y bajos | Baja | Redirección abierta en `/auth/callback`; tokens comparados con `!==`; `"use server"` en `require-role.ts`; tickets con HTML sin escapar (`document.write`); HIBP apagado, contraseña mínima de 6, sin CSP; 389 `as any`; lógica de precio copiada 3 veces. |

Los bloques de riesgo de fondo: la plata depende de que cada acción recuerde validar rol y sucursal; no hay
staging; no hay backups; no hay monitoreo (ni Sentry, ni `error.tsx`, ni health check público; `wrangler.toml` no habilita
observabilidad, y el cron de `vercel.json` no corre en Cloudflare).
