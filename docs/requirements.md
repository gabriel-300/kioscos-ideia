# Requisitos y reglas de negocio de kioscos-ideia

Documento liviano: qué es el sistema, para quién, qué hace cada módulo y **qué decisiones no se tocan sin preguntar**.
No intenta cubrir todo el negocio. Cómo está construido: `docs/architecture.md`.

- **Última verificación**: 2026-09-19, contra la base viva (solo lectura) y `master` en `30ea688`.
- **Estados** que se usan: **Funcionando** (en producción con uso real verificado en la base), **Probado** (verificado de
  punta a punta pero con poco o ningún uso real), **Pendiente de probar**, **Inactivo a propósito** (existe y está apagado
  por decisión del usuario), **Pendiente de configurar**.
- Lo que no se pudo verificar está marcado **(sin verificar)**.

---

## 1. Qué es el sistema, quién lo usa y los locales

Sistema de punto de venta y administración para los kioscos de En Minutas / IDEIA (alimentos congelados y minutas):
venta, caja y turnos, stock, tesorería de los socios, informes, cobro con Mercado Pago y, desde septiembre de 2026, pedidos
online por sucursal. Es una app web (Next.js sobre Supabase, en Cloudflare Workers) que se usa desde la PC del kiosco y desde el celular.

**Locales** (3 sucursales cargadas en la base + 1 nicho de CRM)
| Local | Cómo opera |
|---|---|
| **Parque de las Fiestas** | Kiosco propio, el de mayor volumen (~4.000 movimientos por mes). Auditoría de stock **obligatoria** para cerrar. Pedidos online habilitados solo para retiro; multa de termos configurada ($500 por hora de atraso, 6 horas de gracia). |
| **UNAM** | Kiosco propio. Pedidos online habilitados solo para retiro. Auditoría de stock no obligatoria. |
| **Villa Sarita** | **Concesionario, a consignación**: lo opera un encargado concesionario que es dueño económico de ese local a cambio de un porcentaje de lo que vende. Solo vende la categoría "Minutas" y solo cobra como "Consumidor Final"; sin promos ni pedidos online. Por ahora no es prioridad (sus datos son poco representativos). |
| **Costanera Posadas** | **No es una sucursal cargada**: es el local del brief de Javier (`nicho-posible/brief_tecnico_gabriel.md`) para el CRM de 4 nichos (boliche/nocturno, vecinos del parque, aduana/migraciones, placita del puente). Hoy existe solo la tabla de nichos (4 filas) y un tablero de contactos vacío. |

**Quién lo usa** (usuarios reales al 2026-09-19)
- **Admin** (5 usuarios; 3 son socios: Gabriel, Damián y Javier, con `es_socio`): todo, sin restricción de sucursal.
- **Encargado** (1): su sucursal.
- **Vendedor** (4, 2 bloqueados): su(s) sucursal(es); ve solo lo de su turno del día.
- **Concesionario** (2): Villa Sarita, ve el día completo y el costo/margen de su local.
- **Repartidor** (rol nuevo, sin usuarios reales todavía): solo su cola de entregas.
- **Cliente final**: entra sin cuenta al catálogo público `/pedir/[sucursal]`.

---

## 2. Módulos

Formato: objetivo · quién puede · reglas · casos borde · estado.

### Venta (punto de venta) — `/admin/sucursales/[id]`
- **Objetivo**: cargar ventas rápido, con pago mixto, en el mostrador.
- **Quién**: admin, encargado, vendedor y concesionario de esa sucursal. El vendedor solo si tiene la caja del turno.
- **Reglas**: el precio sale de la base por sucursal, nunca del cliente; canales: Consumidor Final, Pedido Ya Efectivo,
  Pedido Ya Plataforma, Cta. Corriente, Ambulante (pide "quién vendió") y Ronda comunidad; promos y recetas descuentan el
  stock de sus componentes; los productos por kg admiten decimales; si un producto tiene "% de merma al preparar" la
  venta genera sola un movimiento de merma (15% hoy, en los productos configurados).
- **Casos borde**: doble clic crea dos ventas (no hay idempotencia); una venta de staff exige caja abierta y un producto sin precio de
  la sucursal no se vende; una venta se anula solo con la caja abierta y con motivo.
- **Estado**: **Funcionando** (11.300 ventas desde julio).

### Caja: apertura, cierre, traspaso y sobre
- **Objetivo**: que el efectivo del turno cuadre y quede registro de quién tuvo la plata.
- **Quién**: quien tenga acceso a la sucursal; el vendedor solo cierra el turno que tiene en custodia.
- **Reglas**: una caja abierta por sucursal a la vez; el cierre recalcula los totales en el servidor; diferencia distinta de
  cero exige una nota; **Traspaso de turno** cambia la persona sin cerrar la caja (el que recibe declara el efectivo real);
  el **sobre** (`efectivo declarado − fondo siguiente`) lo confirma quien lo retira, con su propia sesión, y otro lo verifica.
- **Casos borde**: un turno que cruza la medianoche sigue siendo el mismo turno (corregido); el cierre bloquea si la
  sucursal tiene auditoría obligatoria y el turno no se auditó.
- **Estado**: **Funcionando** (203 cierres, 55 traspasos). El circuito de "verificar el sobre" con el diseño compacto: **pendiente
  de probar** por alguien que no sea quien lo desarrolló **(sin verificar)**.

### Stock: entregas, ajustes, mermas y transferencias
- **Objetivo**: saber cuánto hay en cada local.
- **Quién**: entregas solo admin/encargado (el costo cargado alimenta márgenes y alertas); ajustes de stock solo admin;
  mermas cualquier staff (motivo obligatorio); transferencias: cualquiera del origen envía y cualquiera del destino confirma.
- **Reglas**: el stock se deriva de los movimientos; una transferencia saca del origen al enviar y el destino suma solo lo
  que confirma haber recibido; anular una transferencia es solo admin.
- **Casos borde**: hay 2 transferencias enviadas y sin confirmar; el stock negativo **no se bloquea** (ver §3).
- **Estado**: **Funcionando** (48 transferencias, 3.500 mermas automáticas). La lectura de remitos por foto (Groq) está en
  producción; el chequeo de stock negativo está **inactivo a propósito**.

### Auditoría de stock por turno — `/admin/auditoria`
- **Objetivo**: contar físicamente al cerrar y detectar diferencias.
- **Reglas**: una auditoría por turno; una diferencia sin observación se rechaza; el admin aprueba el ajuste (genera un
  movimiento de ajuste) o marca "revisado sin ajustar". Es **obligatoria para cerrar solo en Parque de las Fiestas**.
- **Estado**: **Funcionando** (143 auditorías); en UNAM y Villa Sarita **inactiva a propósito** (falta capacitar al personal).

### Reposición — `/admin/reposicion` y `GET /api/reposicion-hoy`
- **Objetivo**: avisar qué hay que pedir (solo un aviso, no genera el pedido al proveedor).
- **Quién**: admin (y el endpoint, con token, para n8n). Por punto mínimo/pedido/máximo y por ciclo fijo (diario o un día).
- **Estado**: **Pendiente de configurar**: hay 6 puntos de pedido cargados y 2 productos con proveedor; falta `REPOSICION_API_TOKEN`
  y el workflow de n8n.

### Termos (alquiler) — `/admin/termos`
- **Reglas**: DNI y teléfono obligatorios al prestar; un DNI con multa impaga en cualquier sucursal no puede alquilar;
  multa = horas de atraso (redondeadas hacia arriba, menos las horas de gracia) × tarifa; se cobra como una venta normal.
- **Estado**: **Funcionando** (12 termos, 0 prestados hoy). La tarifa de multa está configurada solo en Parque ($500/h).

### Cuenta corriente
- **Objetivo**: fiado a personal interno y, si un admin lo habilita, a contactos externos.
- **Reglas**: límite de crédito validado dentro de la base; los pagos se registran con medio (efectivo/billetera).
- **Estado**: personal interno **Funcionando** (362 ventas fiadas, 8 pagos). Contactos externos (rondas de comunidad): **pendiente
  de probar** (0 contactos).

### Tesorería — `/admin/tesoreria`, pagos a proveedores, socios, gastos
- **Quién**: Posición de caja y Socios: admin o socio (`es_socio`). Pagos a proveedores: admin y el encargado de esa
  sucursal (y concesionario). Socios: **no** el concesionario. Gastos: solo admin.
- **Reglas**: `Posición = efectivo en cajones + sobres pendientes − deuda a proveedores − deuda a socios`; deuda a
  proveedores por proveedor con piso en cero; solo el retiro **temporal** de un socio es deuda (el retiro de ganancias no);
  solo el efectivo de esos pagos entra a la conciliación del cierre, la billetera es informativa.
- **Estado**: Posición de caja **Funcionando**; Pagos a proveedores **Probado** (2 pagos); Socios **Pendiente de probar** (0
  retiros ni devoluciones) y Gastos sin uso real (0 gastos, 1 gasto fijo).

### Informes — ventas, cierres, informe mensual, rotación, pronóstico, horario, vendedor
- **Quién**: admin y concesionario (su sucursal). Informe mensual y Tesorería: admin o socio.
- **Reglas**: las ventas de Cta. Corriente y Pedido Ya Plataforma se excluyen de los totales de caja (no se cobran en el
  momento); la rotación por producto compara cantidades y muestra "—" cuando no hubo entregas; el pronóstico es el promedio
  de las últimas 12 veces que cayó el mismo día de la semana.
- **Caso borde crítico**: las consultas que traen filas de ventas se cortan en 1.000 (ver `architecture.md` §9).
- **Estado**: **Funcionando**. Pronóstico y algunas tarjetas del detalle de sucursal siguen calculándose sobre datos
  truncados hasta que se pagine (pendiente).

### Catálogo: productos, precios por sucursal, promos, categorías, proveedores, alertas de precio
- **Quién**: catálogo global solo admin; el concesionario fija precio y costo de su sucursal en `/admin/sucursales/[id]/precios`.
- **Reglas**: precio y costo son **por sucursal**; un producto activo no se guarda si falta el precio en alguna sucursal
  activa; todo cambio queda en el historial; una entrega con un costo distinto al del catálogo genera una alerta (sin
  umbral); el catálogo público oculta los productos sin precio.
- **Regla de imágenes** (desde el 2026-09-19): las imágenes de productos y promos que se suben deben ser JPG, PNG o WebP, pesar
  hasta 1 MB y medir al menos 400 px de lado; lo ideal es cuadrada (1:1), 1000 × 1000 px, fondo liso y el producto centrado. Si
  no se cumple, el cargador no la sube y abre una ventana que muestra el modelo y los motivos. Motivo: cada imagen se descarga en
  cada pantalla de venta y en el catálogo público, y las pesadas agotaron la cuota de tráfico de Supabase.
- **Estado**: **Funcionando** (225 productos, 196 activos; 209 alertas).

### Cobro con QR de Mercado Pago (mostrador)
- **Reglas**: el QR lleva el monto; el pago se detecta solo pero **la venta la confirma el vendedor con un clic**; vincular
  un pago a una venta exige la misma sucursal y el monto exacto.
- **Estado**: **Funcionando** (3.338 pagos QR). Abierto: 142 pagos sin venta vinculada ($733.980) para revisar en
  `/admin/conciliacion-mercadopago`.

### Pedidos online — `/pedir/[sucursal]`, `/admin/pedidos-online`, `/admin/repartos`
- **Objetivo**: vender sin depender del empleado: catálogo público, pedido por retiro o envío, pago en efectivo o por link
  de Mercado Pago.
- **Reglas**: el servidor recalcula precios, promos, stock y envío (por zona); efectivo = pedido confirmado y venta al
  entregar; Mercado Pago por link = el local confirma el pago a mano; pedido mínimo para envío; horario de atención;
  límite de 5 pedidos por 10 minutos por IP.
- **Quién**: el cliente entra sin cuenta; el staff de la sucursal avanza estados; admin y encargado asignan repartidor y
  confirman pagos; el repartidor solo marca sus entregas; la configuración (zonas, horario, delivery) es solo admin.
- **Estado**: **Pendiente de configurar**. Habilitado para retiro en Parque y UNAM, sin horario, sin zonas y con envío
  apagado; solo hay un pedido de prueba. El flujo se probó de punta a punta con Playwright y datos de prueba (borrados).

### Bot de pedidos por WhatsApp
- **Estado**: **Probado** localmente con mensajes sintéticos; **inerte** en producción (falta el alta en Meta Business
  Manager y las claves de WhatsApp). No manda nada a sucursales sin `mercadopago_pos_id`.

### Pedido Ya
- **Estado**: el canal manual en el POS (efectivo y plataforma) está **Funcionando** (227 ventas en 60 días). El webhook está
  **Pendiente de configurar**: sin token ni payload real; solo guarda los eventos.

### CRM de nichos y rondas de comunidad — `/admin/nichos`
- **Estado**: **Pendiente de probar** (0 contactos). "Ronda comunidad" es un canal de venta atribuido a un contacto.

### Staff — `/admin/staff` (solo admin)
- Alta de usuarios (con email confirmado), rol, sucursal, "es socio", límite de crédito, suspender y resetear contraseña.
- **Estado**: **Funcionando**. El alta pública (`/api/auth/registro`) quedó deshabilitada.

---

## 3. Decisiones de negocio que NO deben "corregirse" sin preguntarle al dueño

Cada una tiene un motivo. Si algo de acá parece un error, es una decisión: preguntar primero.

1. **El chequeo de stock negativo está apagado** (`crear_movimiento_con_items`, migración 024, comentario `DESACTIVADO
   TEMPORALMENTE`). Motivo: el stock real todavía se está ajustando y bloqueaba ventas legítimas. El usuario pidió
   **no reactivarlo ni recordarlo** hasta que él lo pida.
2. **La auditoría de stock por turno está inactiva por defecto y es obligatoria solo en Parque de las Fiestas.** Motivo:
   hay que capacitar al personal antes de bloquear cierres. La activa el admin tildando el flag de cada sucursal.
3. **Mercado Pago del mostrador no confirma la venta solo**: el vendedor la confirma con un clic. Decisión explícita del usuario.
4. **Storefront: sin variantes con recargo** (cada tamaño es un producto con su stock y precio); efectivo se cobra en la
   puerta y la venta se registra al entregar; envío siempre por zona y calculado en el servidor; las zonas **no se
   sembraron** (los valores del diseño eran "a confirmar con el local").
5. **Villa Sarita es a consignación**: el concesionario queda **fuera** de Socios, Tesorería consolidada, Staff, catálogo
   global, gastos, ajustes de stock, aprobar auditorías e integraciones de pago; ve el día completo de su local (no solo su
   turno) y el costo/margen del local. Solo Minutas y solo Consumidor Final.
6. **Pedido Ya Plataforma no concilia con caja** (la app paga después) y el webhook de Pedido Ya **no arma ventas** hasta
   ver un payload real (no se inventa el contrato). En Pedido Ya el precio cobrado puede ser mayor al de catálogo, nunca menor.
7. **Cuenta corriente de contactos externos**: la habilita un admin a mano, contacto por contacto (arranca apagada). El
   personal interno siempre puede tener cuenta corriente, con o sin límite.
8. **WhatsApp: solo registrar contactos, sin auto-respuesta**, por el costo por mensaje de Meta y el riesgo de que baneen el
   número. La única excepción es el bot de pedidos, que solo se activa en sucursales habilitadas para vender online.
9. **La merma de cocción automática es invisible para encargado y vendedor** (pedido explícito), y su campo se llama "% de
   merma al preparar" para servir a otros productos. El 15% actual se debe **revisar contra el pesaje real (9,47%)**: no
   cambiarlo sin decidirlo.
10. **Traspaso de turno**: no se bloquea el botón de cerrar caja por rol (a veces cierra un vendedor solo): se eligió avisar en
    vez de bloquear. Sí se bloquea vender a quien no es el tenedor de la caja.
11. **Sobre**: lo confirma quien lo retira, con su sesión; nadie confirma por otro.
12. **Socios**: `retiro_ganancias` no genera deuda; en la conciliación del cierre entra solo el lado efectivo (la billetera
    es informativa).
13. **Transferencia de stock**: el destino suma solo lo que confirma haber recibido; anular es solo admin.
14. **Anular es soft** (marca con motivo y autor); solo mientras la caja del turno está abierta.
15. **Reposición**: solo avisa (no arma el pedido al proveedor) y es solo admin.
16. **CRM de nichos**: no se creó la tabla puente `nichos_x_local` (un solo local la usa: YAGNI) ni el calendario de contenido.
    El usuario decidió no comunicarle a Javier (socio no técnico) las correcciones técnicas de su propuesta.
17. **Facturación electrónica (AFIP/ARCA) pausada**: no se construye hasta que el usuario lo decida.
18. **Historial de movimientos** usa `.limit(1000)` a propósito: es una lista de "últimos N", no un total.
19. **`created_by` histórico**: las filas anteriores a la trazabilidad se completaron con el admin de aquel momento (mejor
    aproximación, **no es un dato certero**).
20. **Migraciones a mano y MCP de Supabase en solo lectura**: las migraciones las corre el usuario (o Claude con su
    confirmación cada vez); no hay staging.
21. **Diferidos el 05/07 antes del go-live** (decisión de priorizar solo los críticos): atribución del dinero de promos en
    reportes, reasignación de sucursal y cuenta corriente histórica, `/admin/cierres` global desincronizado, fondo inicial sin
    arrastre **(sin verificar cuáles se resolvieron después)**.

---

## 4. Requisitos no funcionales

- **La plata no puede descuadrar.** Operaciones de dinero en transacciones (RPC), con lock por sucursal o persona; totales
  recalculados en el servidor; montos redondeados a centavos; CHECK en la base para montos; diferencia de caja con nota
  obligatoria; anulación en vez de borrado.
- **Hay que poder auditar quién hizo qué.** Cada fila de operación guarda `created_by`; las anulaciones guardan autor, hora y
  motivo; el sobre y el traspaso registran quién entregó y quién recibió. Brechas conocidas: las ventas online y
  el borrado de movimientos (`eliminarMovimiento`) no dejan autor o rastro completo.
- **Tiene que ser usable desde el celular.** Los kioscos y los socios usan el celular: las pantallas del admin y el catálogo
  público se verifican a 390 px; las tablas anchas van dentro de un contenedor con scroll horizontal.
- **Todo en español, hora argentina (UTC-3, sin horario de verano), pesos.** Las fechas de negocio se calculan con
  `fechaHoyAR()`, no con la fecha UTC.
- **Privacidad y secretos.** Nada sensible en el cliente, en los logs ni en el repositorio; el costo y el margen no llegan al
  navegador de quien no debe verlos; los datos de clientes (nombre, teléfono, dirección de los pedidos) solo los ve el staff.
- **Disponibilidad y recuperación.** Hoy **no se cumple**: plan gratuito de Supabase sin backups (en curso: backup
  propio cifrado en R2, ver `docs/backups.md`), sin monitoreo de errores y sin entorno de staging. Es el principal riesgo operativo.
- **Cada cambio llega a producción al pushear a `master`**: si las pruebas (229 unitarias, compuerta de CI desde el
  2026-09-19) o el build fallan, no se despliega. Además hay 21 E2E de humo de solo lectura, que se corren a mano.

---

## 5. Pendientes de mi lado (del dueño del negocio)

Estado verificado el 2026-09-19 en la base y en producción.

| Pendiente | Estado |
|---|---|
| **Backups**: workflow de GitHub cada 6 h → copia cifrada en Cloudflare R2 (decisión: sin pasar a Pro por ahora). Construido y ensayado en local. Faltan: crear el bucket de R2, generar la clave de cifrado, cargar los secrets, la primera corrida real y restaurar una copia en un segundo proyecto (ver `docs/backups.md`). Sigue pendiente confirmar quién es dueño de la organización | 🟡 En curso (todavía 0 copias reales) |
| **Cuota de Supabase excedida (Cached Egress 8,4 GB de 5 GB)**: restringe el proyecto el **18/10/2026** si sigue excedida. Causa: imágenes pesadas. La imagen de "Chipa Bocadito Congelada x500g" ya se quitó (19/09); el consumo del ciclo actual no baja, solo deja de crecer. Falta decidir el plan: Pro incluye 250 GB y los backups | ❌ Urgente, con fecha |
| **Aplicar la migración 097** (tope de 1 MB en el bucket `product-images`) y **borrar los 3 PNG pesados** del bucket desde Storage (products/393e9d8b…, c10cb17f…, 422466ae…, ~6 MB, sin uso) | ❌ Pendiente |
| Activar `CRON_SECRET` en Cloudflare | ✅ Hecho (el endpoint responde 401) |
| Aplicar la migración 095 (Storage) | ✅ Hecho (el listado anónimo de remitos da 0) |
| **Aplicar la migración 096** (`confirmar_transferencia_stock` con bloqueo de fila) en el SQL Editor | ❌ Escrita, sin aplicar |
| **Zonas de envío reales** en `/admin/pedidos-online/configuracion` | ❌ 0 zonas |
| **Horario de pedidos** en Parque y UNAM (hoy sin horario = siempre abierto) | ❌ Sin cargar |
| **WhatsApp real** de cada sucursal (número para el catálogo) | ❌ Sin cargar |
| **Habilitar delivery** (después de zonas y de decidir quién rinde el efectivo del envío) | ❌ Apagado en las 3 sucursales |
| **Meta Business Manager** (alta de WhatsApp Cloud API) y cargar `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN` | ❌ Sin arrancar |
| **Token de n8n** (`REPOSICION_API_TOKEN`), armar el workflow y cargar los puntos de pedido y proveedores reales | ❌ Endpoint en 501; 6 puntos cargados |
| **PedidoYa**: token y payload real | ❌ Sin token; 0 eventos |
| **Mercado Pago del storefront**: conectar el armado automático del QR (hoy es link con confirmación manual) | ❌ Sin conectar |
| **Dominio de Resend** y **SMTP de Supabase Auth** (`ideia.com.ar`); hoy no hay SMTP propio | ❌ Sin configurar |
| Prender la protección contra contraseñas filtradas y subir el largo mínimo de contraseña (hoy 6) en Supabase Auth | ❌ Apagado |
| Usuarios de Damián y Javier | ✅ Hecho (ambos con usuario propio y `es_socio`) |
| **Facturación electrónica** (definir con el contador) | ⏸ Pausada por decisión |
| Revisar a mano los **48 cobros QR sin venta** desde el 10/08 ($258.105) y el QR de UNAM del 12/08 ($13.700) | ❌ Abierto |
| Borrar el pedido de prueba (#1) | ❌ Sigue en la base (los préstamos de termo de prueba ya no están abiertos: 0 termos prestados) |
| Decidir la **merma de cocción** (15% vs 9,47% medido) | ❌ Sin decidir |
| Revisar los **5 pares de ventas idénticas** en menos de 10 s (posibles dobles cargas) | ❌ Abierto |
| Confirmar las 2 transferencias de stock que siguen "enviadas" | ❌ Abierto |
| Decidir **cuándo reactivar el chequeo de stock** y **cuándo activar la auditoría obligatoria** en UNAM | ⏸ A pedido del usuario |
| Pruebas manuales que la memoria marca como "falta probar" (transferencia con vendedor real, vendedor en varias sucursales, concesionario en el navegador, ventas ambulantes por persona, rondas de comunidad, precios por sucursal) | ❔ **(sin verificar)** cuáles se hicieron después |

Ver también los hallazgos abiertos de la auditoría en `docs/architecture.md` §10.
