# Brief técnico — Sistema de gestión multinicho / multilocal
### Para: Gabriel Lytwyn — De: Javier
### Costanera Posadas (Cmte. Rebollo 1112, Parque María Morínigo)

---

## 1. Objetivo del proyecto

Armar un sistema que conecte la operación diaria del local (pedidos, mensajes, contenido en redes) con **4 nichos de mercado** ya identificados, de forma que:

- se detecten oportunidades de demanda por nicho,
- se genere y programe contenido dirigido a cada uno,
- se automatice parte de la comunicación (WhatsApp/redes),
- y quede **todo centralizado** en un solo lugar, con métricas de conversión.

El diseño tiene que poder **escalar a otros locales** sin rehacerse — hoy es 1 local (Posadas), pero la arquitectura de datos ya está pensada para más.

---

## 2. Los 4 nichos (contexto de negocio)

| Nicho | Descripción | Ventana horaria |
|---|---|---|
| Boliche / nocturno | Gente que sale de bailar en el centro y busca comer para bajar el alcohol. Diferencial clave: **somos de los pocos que abren** vie/sáb/dom de madrugada. | Vie–dom madrugada |
| Vecinos del parque | Residentes de los edificios cercanos al Parque María Morínigo. Público cautivo por cercanía. | Mañana/tarde |
| Aduana / Migraciones | Trabajadores del paso internacional Posadas–Encarnación. | Cambios de turno |
| Placita del puente | Tránsito peatonal cerca del acceso al puente internacional. | Mediodía |

El local no tiene costo de alquiler/luz/agua, opera con 3 empleados, y ya vende por PedidosYa, WhatsApp y venta directa.

---

## 3. Arquitectura general

```
Local Posadas (hoy)      Local B (futuro)      Local C (futuro)
       │                        │                       │
       └────────────────────────┼───────────────────────┘
                                 ▼
                    BASE CENTRAL (Airtable o equivalente)
        Locales · Nichos · Nichos_x_Local · Contactos_CRM · Calendario_Contenido
                                 │
                    ┌────────────┼─────────────┐
                    ▼            ▼             ▼
              WhatsApp      Redes sociales   Personal / dashboard
             Business      (Meta Business    (bandeja de tickets
              (app/API)       Suite, etc)      por local)
```

**Principio de diseño no negociable:** todo dato lleva `Local_ID` como campo. Un local nuevo se agrega como fila, nunca como sistema/archivo aparte.

---

## 4. Estructura de datos ya definida

Ya armamos la estructura base en un Excel (`base_gestion_multilocal.xlsx`, adjunto) pensado para importarse a Airtable, tabla por tabla. Las tablas y sus campos:

### `Locales`
`Local_ID` (clave), `Nombre_local`, `Direccion`, `Ciudad`, `WhatsApp_numero`, `Horario_resumen`, `Activo` (checkbox), `Fecha_apertura`.

### `Nichos` (catálogo único, reusable entre locales)
`Nicho_ID` (clave), `Nombre_nicho`, `Descripcion`, `Horario_pico`, `Color_tag`.

### `Nichos_x_Local` (tabla puente)
`Local_ID` (vínculo), `Nicho_ID` (vínculo), `Activo_en_este_local` (checkbox), `Notas_locales`.

### `Contactos_CRM` (tabla central — mide conversión)
`Contacto_ID` (clave), `Fecha_hora`, `Local_ID` (vínculo), `Nicho_ID` (vínculo), `Canal` (WhatsApp/Instagram/PedidosYa/Otro), `Nombre_contacto`, `Consulta_mensaje`, `Estado` (Nuevo/En atención/Convertido/Perdido), `Atendido_por`, `Convertido_pedido` (checkbox), `Monto`.

### `Calendario_Contenido`
`Contenido_ID` (clave), `Local_ID` (vínculo), `Nicho_ID` (vínculo), `Fecha_hora_programada`, `Canal`, `Texto_pieza`, `Estado` (Borrador/Programado/Publicado).

**Gabriel: si preferís D1 (SQL nativo de Cloudflare) en vez de Airtable, la estructura relacional de arriba se traduce 1:1 a tablas SQL — quedaría a tu criterio según cómo esté armado el worker existente.**

---

## 5. Los 4 módulos a construir

### Módulo A — Detección de oportunidades
No requiere desarrollo pesado: se apoya en Google Business Profile Insights y Google Trends (herramientas externas gratuitas), más carga manual/semiautomática de señales (reseñas, hashtags locales). Si hay tiempo de desarrollo disponible, lo único automatizable con valor real sería un **cron job liviano** que descargue periódicamente los Insights de Google Business Profile (vía su API) y los vuelque a la base central.

### Módulo B — Generación de contenido
Piezas armadas en Canva (manual, con IA asistida) y programadas en Meta Business Suite. No hay necesidad de desarrollo custom acá salvo que se quiera un flujo que tome filas de `Calendario_Contenido` y dispare la publicación automáticamente vía la API de Meta — **opcional para una fase posterior**.

### Módulo C — Comunicación automatizada
- Nivel base: WhatsApp Business app (manual, sin desarrollo).
- Nivel con desarrollo: automatización con **n8n** (o código directo si preferís no depender de una herramienta no-code) que:
  - reciba webhooks de WhatsApp Business API / Instagram,
  - identifique `Local_ID` según el número/cuenta que recibió el mensaje,
  - inserte el contacto en `Contactos_CRM` con estado `Nuevo`.
- Mensaje automático de madrugada (vie/sáb/dom) para el nicho boliche: puede resolverse con la función nativa de "mensaje de ausencia" de WhatsApp Business, sin desarrollo — o con lógica propia si se integra por API.

### Módulo D — Bandeja centralizada + métricas
Esta es la pieza donde el worker de Cloudflare que ya armaste puede encajar directo:
- Una vista/página (o extensión del worker actual) que lea `Contactos_CRM` y la muestre como bandeja tipo kanban (columnas: Nuevo / En atención / Convertido / Perdido), filtrable por `Local_ID` y `Nicho_ID`.
- Un endpoint o vista de métricas: conteo de contactos, tasa de conversión y monto, agrupado por nicho/canal/local.
- Si el worker ya tiene autenticación y estructura de datos (KV/D1), lo ideal es que sea **la capa de vista/API sobre la misma base central**, no un sistema paralelo.

---

## 6. Sobre el prototipo existente (`kioskos-ideia.lytwyn-idea.workers.dev`)

Necesito que me compartas (a mí, Javier, y de ahí se lo paso a Claude para revisar):
1. Qué hace hoy el worker — landing, formulario, panel, API, etc.
2. Si tiene backend con datos (KV, D1, Durable Objects) o es solo frontend estático.
3. El código fuente, para evaluar el punto de integración exacto con la base central y los 4 módulos de arriba.

---

## 7. Stack sugerido (de bajo costo, ya investigado)

| Herramienta | Uso | Costo |
|---|---|---|
| Google Business Profile | Aparecer en búsquedas/Maps | Gratis |
| WhatsApp Business (app o API) | Mensajería con clientes | Gratis (app) / por mensaje (API) |
| Meta Business Suite | Programar contenido | Gratis |
| Canva | Generar piezas de contenido | Gratis / USD 15 mensual |
| Airtable (o D1 si preferís todo en Cloudflare) | Base central de datos | Gratis para este volumen |
| n8n (o desarrollo propio) | Automatizar flujos entre canales y base | Gratis autohospedado |

No hay presupuesto de software corporativo — priorizar planes gratuitos y, si hace falta pagar algo, que sea proporcional al volumen real de la operación (3 empleados, 1 local por ahora).

---

## 8. Prioridad de implementación (fases)

1. **Fase 0:** base central armada (Airtable o D1) con las 5 tablas de la sección 4, cargada con los datos reales del local.
2. **Fase 1:** conexión de WhatsApp Business (o su API) para que los mensajes entrantes caigan automáticamente en `Contactos_CRM`.
3. **Fase 2:** bandeja/dashboard (posiblemente sobre el worker existente) para que el personal gestione los tickets y se vean las métricas de conversión.
4. **Fase 3:** automatización de contenido programado y, si se suma un segundo local, alta de esa fila en `Locales` sin tocar el resto del sistema.

---

## 9. Qué necesito de tu parte

- Confirmación de si trabajás con Airtable como base central o preferís migrar todo a D1/Cloudflare (dado que ya tenés el worker corriendo ahí).
- Estimación de tiempo/esfuerzo para las Fases 0–2 (lo mínimo viable para operar).
- Código fuente o acceso al worker actual para no duplicar trabajo.

Cualquier duda técnica de estructura de datos o de los flujos por nicho, la resolvemos entre vos, yo y Claude en conjunto.
