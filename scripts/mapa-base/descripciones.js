// Contenido curado (castellano llano) para el mapa de la base. Las columnas y las relaciones salen de la base viva
// (catalog.json); acá solo se escribe QUÉ SIGNIFICA cada cosa. Si una columna no está en `col`, se muestra solo su tipo.

const IDEAS = [
  ["El stock no se guarda en ningún lado", "Se calcula sumando los movimientos: las entregas y los ajustes suman; las ventas, devoluciones y mermas restan; lo anulado no cuenta. La \"tabla\" stock_sucursal es una vista (una consulta guardada), no datos."],
  ["Una venta ES un movimiento", "movimientos es la cabecera de todo lo que mueve stock o plata: venta, entrega, devolución, ajuste, merma y las dos puntas de una transferencia. Sus líneas (producto, cantidad, precio) están en movimiento_items."],
  ["Nada se borra: se anula", "Las ventas y transferencias equivocadas se marcan con anulado_en (quién, cuándo y por qué) y dejan de contar en stock, caja e informes, pero siguen visibles."],
  ["El precio y el costo son por sucursal", "Viven en product_prices (y promo_prices para los combos). Las columnas de precio y costo que todavía tiene products son un resto del proyecto anterior: no se usan para vender."],
  ["El rol de una persona NO está en la tabla profiles", "Está en el sistema de usuarios de Supabase (auth.users, campo app_metadata.role), que no aparece en este esquema. profiles guarda datos como la sucursal, el límite de crédito y si es socio. profiles.role es un resto de otra aplicación."],
  ["La caja funciona por turnos", "aperturas_caja abre el turno con un fondo; traspasos_caja registra los cambios de persona sin cerrar; cierres_caja lo cierra. Solo puede haber una caja abierta por sucursal. La diferencia del cierre es una columna calculada."],
  ["Lo que sale de la caja tiene su propia tabla", "Retiros (retiros_caja), pagos a proveedores, retiros y devoluciones de socios y cobros de cuenta corriente restan o suman al efectivo del turno. El cierre los suma solos."],
  ["Un pedido online es una reserva hasta que se cobra", "pedidos y pedido_items guardan lo que pidió el cliente. Recién cuando se cobra (o se entrega, si es efectivo) se crea la venta en movimientos y se enlaza en pedidos.movimiento_id."],
  ["Hay tablas y columnas heredadas", "platform_settings, los campos b2b/gastro de products, profiles.role/canal/zona_id/b2b_status y cuatro tipos (enums) vienen de otro proyecto que comparte la base. Están marcadas como heredadas: no usarlas."],
  ["Quién puede leer y escribir", "Todas las tablas tienen seguridad por filas (RLS), pero casi toda escritura la hace el servidor de la app con una llave especial que la saltea: el control de quién puede hacer qué está en el código (ver architecture.md, secciones 3 y 4)."],
];

const D = (id, nombre, resumen, tablas) => ({ id, nombre, resumen, tablas });
const T = (t, que, detalle, col = {}) => ({ t, que, detalle, col });

const DOMINIOS = [
  D("catalogo", "Catálogo y precios", "Qué se vende y a cuánto. El producto es uno solo para todo el negocio; el precio y el costo son de cada sucursal.", [
    T("categories", "Categorías del catálogo", "Agrupan los productos (por ejemplo Minutas). Las sucursales pueden limitarse a algunas categorías.", { sort_order: "Orden en que se muestran.", is_active: "Si está apagada no aparece.", slug: "Nombre corto para URLs." }),
    T("products", "Un producto del catálogo (una fila por producto)", "Es el producto en sí. El precio y el costo REALES están en product_prices, por sucursal. Varias columnas son heredadas del proyecto anterior y no se usan.", {
      sku: "Código interno único.", name: "Nombre que se ve en pantalla.", category_id: "Categoría a la que pertenece.", is_active: "Apagado = no se vende ni se muestra.",
      vendible_pos: "Si es falso es un insumo: no aparece en la venta del mostrador (pero sí en entregas y stock).", unit_label: "Unidad (unidad, kg…). Los productos por kg admiten decimales.",
      merma_coccion_pct: "Porcentaje de pérdida al preparar (0,15 = 15%): cada venta genera sola una merma proporcional.", stock_minimo: "Aviso de stock bajo (heredado; hoy manda product_prices.punto_minimo).",
      proveedor_id: "Proveedor habitual (para la reposición).", dias_entrega: "Reposición por ciclo: días de la semana en que llega.", dia_pedido: "Reposición por ciclo: día fijo de pedido.",
      cover_image_url: "Imagen del producto (Storage o una URL externa).", costo: "HEREDADO: el costo real está en product_prices. Además no es legible con la sesión de un usuario.",
      precio_dist: "HEREDADO: el precio real está en product_prices.", price_b2c: "HEREDADO del proyecto anterior.", price_b2b: "HEREDADO.", precio_gastro: "HEREDADO.", precio_min: "HEREDADO.",
      margen_dist: "HEREDADO. No legible con la sesión de un usuario.", margen_gastro: "HEREDADO.", margen_min: "HEREDADO.", kg_caja: "HEREDADO.", bolsas_caja: "HEREDADO.", mult_bolsas: "HEREDADO.", pkg_unitario: "HEREDADO.", pkg_bulto: "HEREDADO.", min_quantity_b2b: "HEREDADO.", freezer_required: "HEREDADO.", weight_grams: "Peso en gramos (informativo).",
    }),
    T("product_prices", "Precio, costo y puntos de stock de un producto EN una sucursal", "Una fila por producto y sucursal. Es la fuente de verdad del precio de venta: un producto sin fila acá no se puede vender en esa sucursal.", {
      precio_dist: "Precio de venta en esa sucursal.", costo: "Costo actual (lo actualiza una entrega con otro precio, si el admin lo aprueba).",
      punto_minimo: "Por debajo de esto se avisa stock bajo.", punto_pedido: "Al llegar acá conviene pedir (reposición).", punto_maximo: "Hasta acá se repone (cantidad sugerida = máximo − stock).",
    }),
    T("product_price_history", "Historial de cambios de precio y costo", "Cada vez que cambia el precio o el costo de un producto en una sucursal queda el antes y el después.", { changed_by: "Quién lo cambió.", changed_at: "Cuándo." }),
    T("promos", "Combos y recetas", "Un combo (tipo promo) o una receta (tipo receta) se vende como una sola línea, pero descuenta el stock de sus componentes.", {
      tipo: "promo o receta.", price: "HEREDADO: el precio real por sucursal está en promo_prices.", requiere_termo: "Si es verdadero, al venderla se ofrece prestar un termo.", category_id: "Categoría (para limitar por sucursal).", is_active: "Apagada = no se vende.",
    }),
    T("promo_items", "Los componentes de un combo o receta", "Qué productos lleva cada promo y cuántas unidades de cada uno.", { cantidad: "Unidades del producto por cada promo vendida." }),
    T("promo_prices", "Precio de una promo EN una sucursal", "Igual que product_prices pero para los combos.", { price: "Precio de la promo en esa sucursal." }),
    T("proveedores", "Proveedores", "A quién se le compra. Define cómo se calcula el costo de una entrega.", {
      modo_facturacion: "costo = el costo es lo que se factura; precio_sugerido = el costo se calcula desde el precio de venta.", porcentaje_descuento: "Descuento aplicado al costo en el modo precio_sugerido.",
    }),
    T("alertas_precio", "Aviso: el proveedor cambió el precio", "Se genera sola cuando una entrega trae un costo distinto al cargado. Un admin decide si actualiza el costo o la ignora.", {
      costo_anterior: "Costo que estaba cargado.", costo_nuevo: "Costo de la entrega.", revisado_por: "Quién la resolvió (vacío = pendiente).", costo_actualizado: "Si se aplicó el costo nuevo.",
    }),
  ]),

  D("operacion", "Movimientos y stock", "Todo lo que entra, sale o se vende. Es el corazón de la base: de acá salen el stock, las ventas y los informes.", [
    T("sucursales", "Los locales, con su configuración", "Una fila por local. Además de los datos básicos guarda las reglas de cada uno: qué puede vender, si acepta pedidos online, sus horarios, su Mercado Pago.", {
      encargado_user_id: "Usuario encargado o concesionario del local (así se sabe a qué sucursal pertenece).", is_active: "Apagada = no se ve en ningún lado.",
      auditoria_obligatoria: "Si es verdadero, no se puede cerrar la caja sin auditar el stock del turno.", categorias_habilitadas: "Categorías que este local puede vender (vacío = todas).", canales_habilitados: "Canales de venta permitidos (vacío = todos).", promos_habilitadas: "Si el local puede vender combos.",
      termo_horas_limite: "Horas de gracia antes de cobrar multa por un termo.", termo_tarifa_multa_hora: "Pesos por hora de atraso de un termo.",
      mercadopago_pos_id: "Caja de Mercado Pago del local (para el cobro con QR).", pedidoya_store_id: "Identificador del local en Pedido Ya.", whatsapp_phone_number_id: "Número de WhatsApp Business del local (para el bot).", whatsapp_pedidos: "Número al que el cliente escribe desde el catálogo.",
      pedidos_online_habilitado: "Si acepta pedidos por el catálogo público.", delivery_habilitado: "Si hace envíos.", retiro_habilitado: "Si permite retirar en el local.", horario_pedidos: "Horarios de atención de pedidos online (por día).", pedido_minimo_envio: "Monto mínimo para pedir con envío.",
      retiro_eta_min: "Minutos mínimos de demora para retiro.", retiro_eta_max: "Minutos máximos de demora para retiro.",
    }),
    T("movimientos", "Cabecera de cada movimiento de stock o de plata", "Una fila por operación: una venta, una entrega de mercadería, una merma, un ajuste, una devolución o cada punta de una transferencia. Las líneas están en movimiento_items.", {
      tipo: "venta, entrega, devolucion, ajuste, merma, transferencia_salida o transferencia_entrada.", canal: "Cómo se vendió (texto libre): consumidor_final, pedido_ya_efectivo, pedido_ya_plataforma, cuenta_corriente, ambulante, ronda_comunidad, multa_termo, pedido_online.",
      fecha: "Fecha de negocio (hora argentina); created_at es el instante real (UTC).", pago_efectivo: "Cuánto se cobró en efectivo (sin vuelto).", pago_billetera: "Cobrado por billetera virtual / QR.", pago_tarjeta: "Cobrado con tarjeta.", pago_transferencia: "Cobrado por transferencia.",
      anulado_en: "Si tiene fecha, la operación está anulada y no cuenta.", motivo_anulacion: "Por qué se anuló.", proveedor_id: "En una entrega: a quién se le compró.", proveedor: "Nombre del proveedor en texto (histórico).", nro_remito: "Número del remito de la entrega.", remito_image_url: "Foto del remito.",
      personal_id: "Persona a la que se le fió o que vendió como ambulante.", contacto_id: "Contacto externo (ronda de comunidad o cuenta corriente de un cliente).", created_by: "Quién lo cargó (queda null en las ventas online).",
    }),
    T("movimiento_items", "Las líneas de cada movimiento", "Qué productos y cuántas unidades tuvo cada operación, con su precio.", {
      cantidad: "Unidades (o kilos). Nunca cero; solo un ajuste puede ser negativo.", precio_unitario: "Precio por unidad (vacío en las líneas de un combo: el precio se reparte).", subtotal: "Importe de la línea, redondeado a centavos.", promo_id: "Si viene de un combo, cuál.",
    }),
    T("stock_sucursal", "VISTA: stock actual por sucursal y producto", "No es una tabla: es una consulta que suma los movimientos. Por eso el stock nunca se \"descuadra\" de las ventas.", {}),
    T("transferencias_stock", "Envío de mercadería de una sucursal a otra", "El stock sale del origen al enviar y entra al destino solo cuando alguien confirma lo recibido.", {
      estado: "enviada (en camino) o recibida.", movimiento_salida_id: "Movimiento que descontó el origen.", movimiento_entrada_id: "Movimiento que sumó el destino (al confirmar).", anulada_en: "Si tiene fecha, está anulada (solo un admin).",
    }),
    T("transferencia_items", "Productos de cada transferencia", "Cuánto se envió y cuánto se recibió realmente de cada producto.", { cantidad_enviada: "Lo que salió del origen.", cantidad_recibida: "Lo que confirmó el destino (la diferencia queda a la vista)." }),
    T("auditorias_stock", "Conteo de stock de un turno", "Una auditoría por turno de caja: alguien cuenta lo que hay y se compara con lo que dice el sistema.", { apertura_id: "Turno al que corresponde." }),
    T("auditoria_stock_items", "Resultado del conteo, producto por producto", "Lo que decía el sistema contra lo que se contó. Un admin aprueba el ajuste o lo marca revisado sin ajustar.", {
      stock_sistema: "Lo que calculaba el sistema.", stock_contado: "Lo que se contó.", diferencia: "Contado − sistema.", observacion: "Explicación obligatoria si hay diferencia.", ajuste_aplicado: "Si se generó un movimiento de ajuste.", revisado_por: "Quién lo revisó (vacío = pendiente).",
    }),
    T("termos", "Los termos que se prestan", "Inventario de termos de cada sucursal.", { estado: "disponible, prestado o baja.", tipo: "frio o caliente.", numero: "Número visible del termo (único por sucursal)." }),
    T("prestamos_termo", "Cada préstamo de termo", "Quién se llevó un termo y cuándo lo devolvió, con la multa si se atrasó.", {
      dni: "Documento de quien lo lleva (obligatorio).", telefono: "Teléfono de contacto (obligatorio).", monto_multa: "Multa calculada por el atraso.", multa_pagada_en: "Cuándo se pagó la multa (vacío = debe).", multa_movimiento_id: "Venta con la que se cobró la multa.", fecha_devolucion: "Vacío = todavía prestado.",
    }),
    T("reposicion_marcas_pedido", "Marca de \"ya pedí esto\"", "Evita que la reposición siga avisando de un producto que ya se pidió, hasta que llegue una entrega nueva.", { marcado_en: "Cuándo se marcó." }),
  ]),

  D("caja", "Caja y turnos", "Cómo se cuadra la plata de cada turno. Un turno empieza con una apertura y termina con un cierre.", [
    T("aperturas_caja", "Apertura de un turno de caja", "Empieza el turno con un fondo de efectivo. Puede haber varios turnos por día, pero solo uno abierto por sucursal.", { fondo_inicial: "Efectivo con el que arranca.", fecha: "Fecha de negocio; created_at es el instante real.", created_by: "Quién abrió (es el \"tenedor\" de la caja al principio)." }),
    T("traspasos_caja", "Cambio de persona con la caja abierta", "Cuando cambia quien atiende, el que recibe cuenta el efectivo y queda registro sin cerrar el turno.", {
      efectivo_esperado: "Lo que el sistema calcula que debería haber.", efectivo_real: "Lo que el que recibe contó.", diferencia: "Real − esperado (columna calculada).", entregado_por: "Quién tenía la caja.", recibido_por: "Quién la recibe (y ahora la tiene).",
    }),
    T("cierres_caja", "Cierre de un turno de caja", "Guarda todo lo que se declaró y se calculó al cerrar. Es lo que se ve en el informe de cierres.", {
      efectivo_declarado: "Efectivo contado al cerrar.", billetera_declarada: "Cobrado por billetera/QR (lo calcula el sistema).", tarjeta_declarada: "Cobrado con tarjeta.", transferencia_declarada: "Cobrado por transferencia.",
      total_ventas: "Ventas que se concilian contra la caja (sin fiado ni Pedido Ya plataforma).", total_fiado: "Ventas a cuenta corriente del turno.", total_plataforma: "Ventas de Pedido Ya plataforma (las paga la app después).",
      fondo_inicial: "Fondo de la apertura.", fondo_siguiente: "Fondo que queda para el próximo turno.", retiros_turno: "Retiros de efectivo del turno.", pagos_proveedor_turno: "Pagos a proveedores en efectivo.", retiros_socio_turno: "Retiros de socios.", pagos_ctc_turno: "Cobros de cuenta corriente en efectivo.", pagos_socio_turno: "Devoluciones de socios en efectivo.",
      diferencia: "COLUMNA CALCULADA: (efectivo − fondo + retiros + pagos a proveedor + retiros de socios − cobros de cta. cte. − devoluciones de socios) + billetera + tarjeta + transferencia − total de ventas. Cero = cuadra.",
      numero_liquidacion: "Número correlativo del cierre en esa sucursal.", sobre_retirado_por: "Socio que se llevó el sobre con el efectivo.", sobre_retirado_en: "Cuándo lo retiró.", sobre_verificado_por: "Quién lo recibió y contó.", sobre_monto_verificado: "Cuánto contó.", sobre_notas: "Observaciones del sobre.",
    }),
    T("retiros_caja", "Retiro de efectivo durante el turno", "Plata que sale de la caja (por ejemplo para un gasto chico), con motivo y comprobante.", { monto: "Siempre positivo.", motivo: "Para qué se retiró.", comprobante_image_url: "Foto del comprobante." }),
  ]),

  D("tesoreria", "Tesorería", "La plata de fondo del negocio: lo que se debe a proveedores, lo que retiran los socios y los gastos.", [
    T("gastos", "Gastos reales", "Lo que se pagó, por categoría. Incluye los sueldos.", { categoria: "mercaderia, sueldos, alquiler, servicios u otro.", gasto_fijo_id: "Si es el pago de un gasto fijo, cuál.", empleado_id: "En un sueldo: a quién.", tipo_sueldo: "regular o extra." }),
    T("gastos_fijos", "Gastos que se repiten todos los meses", "El presupuesto mensual: alquiler, servicios, sueldos previstos. Se \"marca pagado\" y eso crea el gasto real.", { monto_estimado: "Cuánto se calcula que sale.", dia_vencimiento: "Día del mes en que vence." }),
    T("pagos_proveedor", "Pagos hechos a proveedores", "La deuda con un proveedor es lo entregado menos lo pagado acá.", { monto_efectivo: "Parte pagada en efectivo (baja la caja del turno).", monto_billetera: "Parte pagada por billetera/transferencia.", movimiento_id: "Entrega puntual que se pagó (opcional)." }),
    T("movimientos_socio", "Retiros de plata de los socios", "Cuando un socio se lleva plata del negocio.", { tipo: "retiro_temporal = se espera que la devuelva (es deuda); retiro_ganancias = reparto de utilidades (no es deuda).", socio_id: "Quién retiró." }),
    T("pagos_socio", "Devoluciones de los socios", "Plata que un socio devuelve por un retiro temporal.", { monto_efectivo: "Devuelto en efectivo.", monto_billetera: "Devuelto por billetera." }),
    T("cta_corriente_pagos", "Pagos de cuenta corriente (fiado)", "Lo que pagan las personas a las que se les fió. El saldo es lo fiado menos estos pagos.", {
      personal_id: "Persona del equipo que debía (o vacío si es un contacto externo).", contacto_id: "Contacto externo que debía (o vacío si es del equipo). Siempre uno de los dos, nunca ambos.", monto: "COLUMNA CALCULADA: efectivo + billetera.",
    }),
  ]),

  D("usuarios", "Usuarios y contactos", "Las personas: el equipo y los contactos comerciales. Recordá que el rol de cada usuario está fuera de este esquema.", [
    T("profiles", "Datos de cada usuario del sistema", "Una fila por usuario. NO tiene el rol: ese está en auth.users. Sirve para guardar a qué sucursal pertenece, su límite de crédito y si es socio.", {
      sucursal_id: "Sucursal activa (los vendedores pueden estar en varias: ver profile_sucursales).", credito_limite: "Tope de fiado (Cta. Corriente); vacío = sin tope.", es_socio: "Marca de socio del negocio (accede a Tesorería).", full_name: "Nombre.",
      role: "HEREDADO de otra aplicación: no es el rol real.", canal: "HEREDADO.", zona_id: "HEREDADO.", b2b_status: "HEREDADO.", document_type: "HEREDADO.", document_number: "HEREDADO.",
    }),
    T("profile_sucursales", "En qué sucursales puede trabajar un vendedor", "Un vendedor puede estar habilitado en más de un local; profiles.sucursal_id indica en cuál está ahora.", {}),
    T("contactos_crm", "Contactos y consultas (CRM de nichos)", "Cada mensaje o consulta de un cliente potencial (WhatsApp, Instagram, Pedido Ya…). También sirve como \"cliente externo\" para las rondas de comunidad y el fiado.", {
      canal: "whatsapp, instagram, pedidosya, ads, ronda_comunidad u otro.", estado: "Nuevo, En atención, Convertido o Perdido.", habilitado_cta_corriente: "Solo un admin lo activa: si no, no se le puede fiar.", limite_credito: "Tope de fiado de este contacto.", nicho_id: "Segmento al que pertenece.",
    }),
    T("nichos", "Segmentos de clientes", "Los cuatro nichos del brief de Javier: boliche/nocturno, vecinos del parque, aduana/migraciones y placita del puente.", {}),
    T("platform_settings", "HEREDADO: configuración de la plataforma anterior", "Una sola fila con datos del proyecto anterior (comisión, banco, CUIT). Hoy no se usa para vender.", {}),
  ]),

  D("pedidos", "Pedidos online", "Lo que pide el cliente por el catálogo público o por WhatsApp, hasta que se cobra y se entrega.", [
    T("pedidos", "Un pedido de un cliente", "Es una reserva con su propio ciclo de vida. Cuando se cobra (o se entrega, en efectivo) se crea la venta real en movimientos.", {
      estado: "pendiente_pago, confirmado, pagado, en_preparacion, listo_retiro, en_reparto, entregado, cancelado o expirado (también carrito).", origen: "storefront (catálogo web) o whatsapp (bot).", tipo_entrega: "retiro_local o delivery.", medio_pago: "efectivo, mercadopago_link o mercadopago_qr.",
      subtotal: "Suma de los productos (calculada por el servidor).", costo_envio: "Costo del envío según la zona (calculado por el servidor).", total: "Subtotal + envío.", pago_con: "En efectivo: con cuánto va a pagar (para el vuelto).",
      movimiento_id: "La venta que se creó al cobrar (vacío = todavía no hay venta).", repartidor_id: "Repartidor asignado.", expira_en: "Vence el pago pendiente (2 horas en link de pago).", zona_entrega_id: "Zona de envío elegida.", bot_paso: "Estado de la conversación del bot de WhatsApp (guarda el carrito en armado).", numero: "Número correlativo visible para el cliente.",
    }),
    T("pedido_items", "Productos de cada pedido", "Cada línea con el precio que calculó el servidor (el cliente nunca manda precios).", { precio_unitario: "Precio por unidad (vacío en las líneas de un combo).", subtotal: "Importe de la línea." }),
    T("zonas_entrega", "Zonas de envío y su costo", "Cada sucursal define sus zonas, cuánto cuesta el envío y la demora. Hoy no hay ninguna cargada.", { costo: "Costo del envío a esa zona.", eta_min: "Minutos mínimos de demora.", eta_max: "Minutos máximos de demora.", orden: "Orden en que se muestran." }),
    T("pedido_rate_limits", "Control anti-abuso del catálogo", "Registra intentos de pedido por IP para limitar a 5 cada 10 minutos. Se purga sola.", { identificador: "IP (o teléfono si falta)." }),
  ]),

  D("integraciones", "Integraciones", "Lo que llega de afuera: pagos de Mercado Pago, pedidos de Pedido Ya y mensajes de WhatsApp.", [
    T("mercadopago_qr_orders", "Cobros por QR de Mercado Pago", "Cada QR que se arma en el mostrador o en el catálogo, y si se pagó.", {
      estado: "pendiente, pagado o cancelado.", external_reference: "Código único que viaja con el pago (así se sabe de qué orden es).", monto: "Importe del QR (fijo).", mp_payment_id: "Identificador del pago en Mercado Pago.", movimiento_id: "Venta a la que se vinculó (vacío = pagado sin venta vinculada).", pedido_id: "Pedido online al que corresponde, si lo hay.", raw_webhook_payload: "Copia de lo que informó Mercado Pago.",
    }),
    T("mercadopago_transferencias_recibidas", "Pagos de Mercado Pago que no coinciden con ningún QR", "Transferencias, segundos pagos o pagos de montos distintos: quedan acá para vincularlos a mano a una venta.", { movimiento_id: "Venta a la que se asignó.", asignado_por: "Quién la asignó." }),
    T("pedidoya_webhook_events", "Avisos crudos de Pedido Ya", "Guarda lo que manda Pedido Ya, sin procesar (todavía no se arman ventas solas).", { raw_payload: "Contenido original." }),
    T("whatsapp_webhook_events", "Mensajes crudos de WhatsApp", "Auditoría de cada mensaje recibido (evita duplicar un mismo mensaje).", { wa_message_id: "Identificador único del mensaje en WhatsApp.", status: "processed, sin_sucursal o error." }),
  ]),
];

// Columnas de significado evidente que no hacía falta explicar en la tabla principal. Clave: "tabla.columna".
// El generador las suma a las de arriba y avisa si alguna no existe o está repetida.
const COLUMNAS_EXTRA = {
  "categories.name": "Nombre de la categoría.", "categories.description": "Descripción (opcional).", "categories.image_url": "Imagen de la categoría.",
  "products.slug": "Nombre corto para URLs.", "products.short_description": "Descripción corta.", "products.description": "Descripción larga.", "products.gallery_urls": "Galería de imágenes (lista en formato JSON).", "products.metadata": "Datos extra sueltos (JSON).",
  "product_price_history.precio_dist_anterior": "Precio de venta antes del cambio.", "product_price_history.precio_dist_nuevo": "Precio de venta después del cambio.", "product_price_history.costo_anterior": "Costo antes del cambio.", "product_price_history.costo_nuevo": "Costo después del cambio.",
  "promos.name": "Nombre del combo o receta.", "promos.cover_image_url": "Imagen del combo o receta.",
  "proveedores.nombre": "Nombre del proveedor.", "proveedores.contacto": "Datos de contacto (texto libre).", "proveedores.is_active": "Apagado = deja de ofrecerse.",
  "alertas_precio.proveedor": "Nombre del proveedor (texto).", "alertas_precio.revisado_en": "Cuándo se resolvió.", "alertas_precio.nota_admin": "Comentario del admin al resolverla.",
  "sucursales.nombre": "Nombre del local.", "sucursales.encargado_nombre": "Nombre del encargado (texto de contacto).", "sucursales.encargado_telefono": "Teléfono del encargado.", "sucursales.encargado_email": "Correo del encargado.", "sucursales.direccion": "Dirección del local.", "sucursales.localidad": "Localidad.", "sucursales.provincia": "Provincia.",
  "movimientos.anulado_por": "Quién anuló la operación.",
  "stock_sucursal.product_name": "Nombre del producto.", "stock_sucursal.sku": "Código interno del producto.", "stock_sucursal.entradas": "Total que entró.", "stock_sucursal.salidas": "Total que salió.", "stock_sucursal.stock_actual": "Entradas menos salidas: lo que hay ahora.",
  "transferencias_stock.sucursal_origen_id": "Local que envía.", "transferencias_stock.sucursal_destino_id": "Local que recibe.", "transferencias_stock.fecha": "Fecha del envío.", "transferencias_stock.notas_envio": "Observaciones al enviar.", "transferencias_stock.notas_recepcion": "Observaciones al recibir.", "transferencias_stock.enviado_por": "Quién envió.", "transferencias_stock.recibido_por": "Quién confirmó la recepción.", "transferencias_stock.confirmado_en": "Cuándo se confirmó la recepción.", "transferencias_stock.anulada_por": "Quién la anuló.", "transferencias_stock.motivo_anulacion": "Por qué se anuló.",
  "auditorias_stock.fecha": "Fecha del conteo.", "auditoria_stock_items.revisado_en": "Cuándo se revisó.", "auditoria_stock_items.nota_admin": "Comentario del admin al revisar.",
  "termos.image_url": "Foto del termo.",
  "prestamos_termo.nombre": "Nombre de quien se lo lleva.", "prestamos_termo.movimiento_id": "Movimiento asociado al préstamo.", "prestamos_termo.fecha_prestamo": "Cuándo se prestó.", "prestamos_termo.prestado_by": "Quién lo prestó.", "prestamos_termo.devuelto_by": "Quién recibió la devolución.",
  "reposicion_marcas_pedido.marcado_por": "Quién lo marcó.",
  "cierres_caja.fecha": "Fecha de negocio del cierre.", "cierres_caja.sobre_verificado_en": "Cuándo se verificó el sobre.",
  "retiros_caja.fecha": "Fecha de negocio del retiro.",
  "gastos.monto": "Importe pagado.", "gastos.fecha": "Fecha del gasto.", "gastos.proveedor": "Proveedor o destinatario (texto).",
  "gastos_fijos.categoria": "Misma clasificación que en gastos.", "gastos_fijos.descripcion": "Qué es (por ejemplo, alquiler).", "gastos_fijos.is_active": "Apagado = ya no se presupuesta.",
  "pagos_proveedor.proveedor_id": "A quién se le pagó.", "pagos_proveedor.fecha_pago": "Cuándo se pagó.", "pagos_proveedor.nota": "Observación.",
  "movimientos_socio.monto": "Importe retirado.", "movimientos_socio.fecha": "Fecha del retiro.",
  "pagos_socio.socio_id": "Socio que devuelve.", "pagos_socio.fecha": "Fecha de la devolución.",
  "cta_corriente_pagos.fecha": "Fecha del pago.", "cta_corriente_pagos.monto_efectivo": "Pagado en efectivo (entra a la caja del turno).", "cta_corriente_pagos.monto_billetera": "Pagado por billetera o transferencia.",
  "profiles.phone": "Teléfono.",
  "contactos_crm.fecha_hora": "Cuándo llegó la consulta.", "contactos_crm.nombre_contacto": "Nombre de quien consultó.", "contactos_crm.consulta_mensaje": "Lo que escribió.", "contactos_crm.atendido_por": "Quién la atendió.", "contactos_crm.convertido_pedido": "Si terminó en un pedido.", "contactos_crm.monto": "Monto asociado, si lo hubo.",
  "nichos.nombre": "Nombre del segmento.", "nichos.descripcion": "Descripción del segmento.", "nichos.horario_pico": "Horario de mayor movimiento.", "nichos.color_tag": "Color para distinguirlo en pantalla.", "nichos.is_active": "Apagado = no se ofrece.",
  "platform_settings.ideaia_commission_rate": "HEREDADO: comisión de la plataforma anterior.", "platform_settings.bank_cbu": "HEREDADO: dato bancario de la plataforma anterior.", "platform_settings.bank_alias": "HEREDADO: dato bancario de la plataforma anterior.", "platform_settings.bank_holder": "HEREDADO: dato bancario de la plataforma anterior.", "platform_settings.cuit_emisor": "HEREDADO: CUIT de la plataforma anterior.", "platform_settings.whatsapp_phone_display": "HEREDADO: teléfono que mostraba la plataforma anterior.",
  "pedidos.cliente_nombre": "Nombre del cliente.", "pedidos.cliente_telefono": "Teléfono del cliente.", "pedidos.cliente_wa_id": "Identificador de WhatsApp del cliente (lo usa el bot).", "pedidos.descuento_total": "Descuento aplicado (suma).", "pedidos.contacto_id": "Contacto del CRM que corresponde al cliente.", "pedidos.direccion_entrega": "Dirección del envío.", "pedidos.zona_nombre": "Nombre de la zona al momento del pedido.", "pedidos.direccion_referencia": "Referencia para ubicar la dirección.", "pedidos.eta_min": "Demora estimada mínima (minutos).", "pedidos.eta_max": "Demora estimada máxima (minutos).",
  "pedido_items.cantidad": "Cantidad pedida.",
  "zonas_entrega.nombre": "Nombre de la zona.", "zonas_entrega.is_active": "Apagada = no se ofrece.",
  "mercadopago_qr_orders.paid_at": "Cuándo se pagó.",
  "mercadopago_transferencias_recibidas.mp_payment_id": "Identificador del pago en Mercado Pago.", "mercadopago_transferencias_recibidas.monto": "Importe recibido.", "mercadopago_transferencias_recibidas.recibido_en": "Cuándo llegó el aviso.", "mercadopago_transferencias_recibidas.raw_payload": "Copia de lo que informó Mercado Pago.", "mercadopago_transferencias_recibidas.asignado_en": "Cuándo se asignó a una venta.",
  "pedidoya_webhook_events.received_at": "Cuándo llegó el aviso.", "pedidoya_webhook_events.external_order_id": "Número del pedido en Pedido Ya.", "pedidoya_webhook_events.external_store_id": "Local según Pedido Ya.", "pedidoya_webhook_events.movimiento_id": "Venta creada a partir del aviso, si la hubo.", "pedidoya_webhook_events.status": "Estado del procesamiento.", "pedidoya_webhook_events.error_message": "Error, si falló.", "pedidoya_webhook_events.processed_at": "Cuándo se procesó.",
  "whatsapp_webhook_events.received_at": "Cuándo llegó el mensaje.", "whatsapp_webhook_events.raw_payload": "Mensaje original.", "whatsapp_webhook_events.wa_from": "Número de quien escribe.", "whatsapp_webhook_events.phone_number_id": "Número de WhatsApp Business que lo recibió.", "whatsapp_webhook_events.contacto_id": "Contacto del CRM asociado.", "whatsapp_webhook_events.error_message": "Error, si falló.",
};

module.exports = { IDEAS, DOMINIOS, COLUMNAS_EXTRA };
