import { createAdminClient } from "@/lib/supabase/server";
import { resolverItemsPedido, type ItemCarritoInput } from "./pricing";
import { chequearStockLiviano } from "./stock";
import { chequearRateLimit } from "./rate-limit";
import { interpretarPedidoConIA } from "./interpretar-pedido-ia";
import { enviarTexto, enviarBotones, enviarLista } from "@/lib/whatsapp/enviar-mensaje";

// Motor del bot de pedidos por WhatsApp (Fase 3 del storefront, ver plan).
// Invocado una vez por mensaje entrante YA deduplicado por
// src/app/api/webhooks/whatsapp/route.ts (índice único en wa_message_id) --
// acá no se agrega ninguna deduplicación nueva.
//
// El carrito "en vivo" (mientras el cliente todavía está eligiendo) se
// guarda en pedidos.bot_paso como JSON -- NO en pedido_items. Un ítem de
// promo, mientras se está armando el carrito, tiene que mostrarse como UNA
// línea ("2x Combo Mediodía — $4800"), pero resolverItemsPedido() lo
// expande en sus componentes (misma lógica que crearMovimiento, ver
// pricing.ts) -- si se persistiera esa expansión en pedido_items en cada
// toque, se perdería la cantidad "lógica" de la promo (las filas quedan a
// nivel de producto componente, no de promo) y habría que reconstruirla a
// mano cada vez. Guardar el carrito crudo evita ese problema: pedido_items
// recién se escribe UNA vez, en finalizarPedido(), con el resultado ya
// expandido -- exactamente la misma forma que ya usa iniciarPedido() del
// storefront.

type ItemCarrito = { id: string; esPromo: boolean; cantidad: number };

type BotState =
  | { modo: "menu"; carrito: ItemCarrito[] }
  | { modo: "pidiendo_nombre"; carrito: ItemCarrito[] }
  | { modo: "ia_pendiente"; carrito: ItemCarrito[]; propuesta: ItemCarrito[] };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const EXPIRACION_MS = 15 * 60 * 1000; // mismo plazo que iniciarPedido() del storefront
const ITEMS_POR_PAGINA = 9; // + 1 fila "ver más" = 10, el máximo real de una lista de WhatsApp

function leerEstado(botPaso: string | null): BotState {
  if (botPaso) {
    try {
      const parsed = JSON.parse(botPaso);
      if (parsed && Array.isArray(parsed.carrito)) return parsed as BotState;
    } catch { /* bot_paso viejo/corrupto -- se arranca de cero */ }
  }
  return { modo: "menu", carrito: [] };
}

function guardarEstado(state: BotState): string {
  return JSON.stringify(state);
}

type ItemBot = { id: string; esPromo: boolean; name: string; price: number; category_id: string };
type Catalogo = { categorias: { id: string; name: string }[]; itemsPorCategoria: Map<string, ItemBot[]>; todosLosItems: ItemBot[] };

const SIN_CATEGORIA = "_sin_categoria";

// Mismo filtro (categorias_habilitadas/promos_habilitadas/is_active/
// vendible_pos) que ya usan src/app/pedir/[sucursal]/page.tsx y
// pricing.ts -- copiado a propósito, no importado desde ahí (ese archivo
// es un Server Component de Next, no una función reusable), mismo criterio
// que ya se usó en toda la Fase 2.
async function cargarCatalogo(admin: ReturnType<typeof createAdminClient>, sucursalId: string): Promise<Catalogo> {
  const { data: sucursal } = await (admin as any)
    .from("sucursales")
    .select("categorias_habilitadas, promos_habilitadas")
    .eq("id", sucursalId)
    .single();
  const categoriasHabilitadas: string[] | null = sucursal?.categorias_habilitadas ?? null;
  const promosHabilitadas: boolean = sucursal?.promos_habilitadas ?? true;

  const [{ data: categoriesRaw }, { data: productsRaw }, { data: preciosRaw }, { data: promosRaw }, { data: preciosPromoRaw }] = await Promise.all([
    admin.from("categories").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    (admin as any).from("products").select("id, name, category_id, vendible_pos").eq("is_active", true).neq("sku", "MULTA-TERMO").order("name"),
    admin.from("product_prices").select("product_id, precio_dist").eq("sucursal_id", sucursalId),
    (admin as any).from("promos").select("id, name, price, category_id").eq("is_active", true).order("name"),
    (admin as any).from("promo_prices").select("promo_id, price").eq("sucursal_id", sucursalId),
  ]);

  const precioProducto = new Map((preciosRaw ?? []).map((p: any) => [p.product_id as string, p.precio_dist as number]));
  const precioPromo = new Map((preciosPromoRaw ?? []).map((p: any) => [p.promo_id as string, p.price as number]));

  const categoriasReales = (categoriasHabilitadas && categoriasHabilitadas.length > 0
    ? (categoriesRaw ?? []).filter((c: any) => categoriasHabilitadas.includes(c.id))
    : (categoriesRaw ?? [])) as { id: string; name: string }[];
  const categoriaIdsHabilitadas = new Set(categoriasReales.map((c) => c.id));

  const todosLosItems: ItemBot[] = [];

  for (const p of (productsRaw ?? []) as any[]) {
    if (p.vendible_pos === false) continue;
    if (categoriasHabilitadas && categoriasHabilitadas.length > 0) {
      if (!p.category_id || !categoriaIdsHabilitadas.has(p.category_id)) continue;
    }
    const price = precioProducto.get(p.id);
    if (price == null || !(price > 0)) continue;
    todosLosItems.push({ id: p.id, esPromo: false, name: p.name, price, category_id: p.category_id ?? SIN_CATEGORIA });
  }

  if (promosHabilitadas) {
    for (const p of (promosRaw ?? []) as any[]) {
      if (categoriasHabilitadas && categoriasHabilitadas.length > 0) {
        if (!p.category_id || !categoriaIdsHabilitadas.has(p.category_id)) continue;
      }
      const price = precioPromo.get(p.id) ?? p.price;
      if (price == null || !(price > 0)) continue;
      todosLosItems.push({ id: p.id, esPromo: true, name: p.name, price, category_id: p.category_id ?? SIN_CATEGORIA });
    }
  }

  const itemsPorCategoria = new Map<string, ItemBot[]>();
  for (const item of todosLosItems) {
    const arr = itemsPorCategoria.get(item.category_id) ?? [];
    arr.push(item);
    itemsPorCategoria.set(item.category_id, arr);
  }

  const categorias = categoriasReales.filter((c) => (itemsPorCategoria.get(c.id)?.length ?? 0) > 0);
  if ((itemsPorCategoria.get(SIN_CATEGORIA)?.length ?? 0) > 0) {
    categorias.push({ id: SIN_CATEGORIA, name: "Promos" });
  }

  return { categorias, itemsPorCategoria, todosLosItems };
}

async function mandarCategorias(phoneNumberId: string, waId: string, catalogo: Catalogo) {
  if (catalogo.categorias.length === 0) {
    await enviarTexto(phoneNumberId, waId, "Por ahora no hay productos cargados para pedir. Probá de nuevo más tarde.");
    return;
  }
  const rows = catalogo.categorias.slice(0, 10).map((c) => ({ id: `cat_${c.id}`, title: c.name }));
  await enviarLista(phoneNumberId, waId, "¡Hola! ¿Qué categoría querés ver?", "Ver categorías", [{ title: "Categorías", rows }]);
}

async function mandarProductosDeCategoria(phoneNumberId: string, waId: string, catalogo: Catalogo, categoriaId: string, offset: number) {
  const items = catalogo.itemsPorCategoria.get(categoriaId) ?? [];
  if (items.length === 0) {
    await enviarTexto(phoneNumberId, waId, "Esa categoría no tiene productos disponibles ahora.");
    return;
  }
  const pagina = items.slice(offset, offset + ITEMS_POR_PAGINA);
  const rows: { id: string; title: string; description?: string }[] = pagina.map((it) => ({
    id: `${it.esPromo ? "promo" : "prod"}_${it.id}`,
    title: it.name,
    description: AR.format(it.price),
  }));
  if (offset + ITEMS_POR_PAGINA < items.length) {
    rows.push({ id: `masprod_${categoriaId}_${offset + ITEMS_POR_PAGINA}`, title: "Ver más productos" });
  }
  await enviarLista(phoneNumberId, waId, "Elegí un producto:", "Ver productos", [{ title: "Productos", rows }]);
}

function agregarAlCarrito(carrito: ItemCarrito[], id: string, esPromo: boolean, cantidad: number): ItemCarrito[] {
  const idx = carrito.findIndex((c) => c.id === id && c.esPromo === esPromo);
  if (idx >= 0) {
    const copia = [...carrito];
    copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + cantidad };
    return copia;
  }
  return [...carrito, { id, esPromo, cantidad }];
}

function fusionarCarritos(base: ItemCarrito[], agregar: ItemCarrito[]): ItemCarrito[] {
  let resultado = base;
  for (const item of agregar) resultado = agregarAlCarrito(resultado, item.id, item.esPromo, item.cantidad);
  return resultado;
}

function formatearCarrito(carrito: ItemCarrito[], catalogoMap: Map<string, ItemBot>): { texto: string; total: number } {
  let total = 0;
  const lineas = carrito
    .map((c) => {
      const item = catalogoMap.get(c.id);
      if (!item) return null;
      const subtotal = item.price * c.cantidad;
      total += subtotal;
      return `${c.cantidad}x ${item.name} — ${AR.format(subtotal)}`;
    })
    .filter((l): l is string => !!l);
  return { texto: lineas.join("\n"), total };
}

async function guardarCarrito(admin: ReturnType<typeof createAdminClient>, pedidoId: string, carrito: ItemCarrito[]) {
  await (admin as any).from("pedidos").update({ bot_paso: guardarEstado({ modo: "menu", carrito }) }).eq("id", pedidoId);
}

const BOTONES_CARRITO = [
  { id: "accion_seguir", title: "Seguir comprando" },
  { id: "accion_finalizar", title: "Finalizar pedido" },
  { id: "accion_vaciar", title: "Vaciar carrito" },
];

// Reimplementa el tramo final de iniciarPedido() del storefront (rate
// limit → stock → transición de estado) en vez de llamarla directo: esa
// función SIEMPRE inserta un pedido nuevo desde cero con su carrito
// completo; acá el pedido ya existe y se viene construyendo de a un
// mensaje. Reusa las mismas piezas (chequearRateLimit/chequearStockLiviano/
// resolverItemsPedido) sin duplicar la lógica interna de ninguna.
async function finalizarPedido(
  admin: ReturnType<typeof createAdminClient>,
  pedido: { id: string; cliente_nombre: string | null },
  carrito: ItemCarrito[],
  phoneNumberId: string,
  waId: string,
  sucursalId: string
) {
  const rateLimitError = await chequearRateLimit(admin, `wa:${waId}`);
  if (rateLimitError) { await enviarTexto(phoneNumberId, waId, rateLimitError); return; }

  const itemsInput: ItemCarritoInput[] = carrito.map((c) =>
    c.esPromo ? { promo_id: c.id, cantidad: c.cantidad } : { product_id: c.id, cantidad: c.cantidad }
  );
  const resuelto = await resolverItemsPedido(admin, sucursalId, itemsInput);
  if ("error" in resuelto) { await enviarTexto(phoneNumberId, waId, resuelto.error); return; }

  const stockError = await chequearStockLiviano(admin, sucursalId, resuelto.items);
  if (stockError) { await enviarTexto(phoneNumberId, waId, stockError); return; }

  const { data: transicionado, error: updError } = await (admin as any)
    .from("pedidos")
    .update({
      estado: "pendiente_pago",
      subtotal: resuelto.subtotal,
      total: resuelto.total,
      medio_pago: "mercadopago_qr",
      expira_en: new Date(Date.now() + EXPIRACION_MS).toISOString(),
      bot_paso: guardarEstado({ modo: "menu", carrito: [] }),
    })
    .eq("id", pedido.id)
    .eq("estado", "carrito")
    .select("id");
  if (updError || !transicionado?.length) {
    await enviarTexto(phoneNumberId, waId, "Hubo un problema guardando tu pedido, probá de nuevo en un momento.");
    return;
  }

  const { error: itemsError } = await (admin as any)
    .from("pedido_items")
    .insert(resuelto.items.map((i) => ({ pedido_id: pedido.id, ...i })));
  if (itemsError) console.error("[bot-whatsapp] error guardando pedido_items:", itemsError.message);

  // Mismo texto de "todavía no se puede pagar" que ya usa el stub de
  // iniciarPedido() del storefront -- pendiente de conectar el QR real de
  // Mercado Pago, mismo bloqueo ya conocido (ver plan de Fase 2).
  await enviarTexto(
    phoneNumberId, waId,
    `¡Gracias${pedido.cliente_nombre ? `, ${pedido.cliente_nombre}` : ""}! Tu pedido quedó guardado por ${AR.format(resuelto.total)}.\n\nEl pago por acá todavía no está conectado -- en breve te contactamos para coordinar el pago y la entrega.`
  );
}

async function manejarRespuestaInteractiva(
  admin: ReturnType<typeof createAdminClient>,
  pedido: { id: string; cliente_nombre: string | null },
  estado: BotState,
  replyId: string,
  catalogo: Catalogo,
  catalogoMap: Map<string, ItemBot>,
  phoneNumberId: string,
  waId: string,
  sucursalId: string
) {
  if (replyId.startsWith("cat_")) {
    await mandarProductosDeCategoria(phoneNumberId, waId, catalogo, replyId.slice(4), 0);
    return;
  }
  if (replyId.startsWith("masprod_")) {
    const resto = replyId.slice("masprod_".length);
    const idx = resto.lastIndexOf("_");
    const catId = idx >= 0 ? resto.slice(0, idx) : resto;
    const offset = idx >= 0 ? (parseInt(resto.slice(idx + 1), 10) || 0) : 0;
    await mandarProductosDeCategoria(phoneNumberId, waId, catalogo, catId, offset);
    return;
  }
  if (replyId.startsWith("prod_") || replyId.startsWith("promo_")) {
    const esPromo = replyId.startsWith("promo_");
    const id = replyId.slice(esPromo ? "promo_".length : "prod_".length);
    const item = catalogoMap.get(id);
    if (!item) { await enviarTexto(phoneNumberId, waId, "Ese producto ya no está disponible."); return; }
    const carrito = agregarAlCarrito(estado.carrito, id, esPromo, 1);
    await guardarCarrito(admin, pedido.id, carrito);
    const { texto, total } = formatearCarrito(carrito, catalogoMap);
    await enviarBotones(phoneNumberId, waId, `Agregado: ${item.name}\n\nTu pedido:\n${texto}\n\nTotal: ${AR.format(total)}`, BOTONES_CARRITO);
    return;
  }
  if (replyId === "accion_seguir") {
    await mandarCategorias(phoneNumberId, waId, catalogo);
    return;
  }
  if (replyId === "accion_vaciar") {
    await guardarCarrito(admin, pedido.id, []);
    await enviarTexto(phoneNumberId, waId, "Listo, vacié tu carrito.");
    return;
  }
  if (replyId === "accion_finalizar") {
    if (estado.carrito.length === 0) { await enviarTexto(phoneNumberId, waId, "Todavía no agregaste nada a tu pedido."); return; }
    if (!pedido.cliente_nombre) {
      await (admin as any).from("pedidos")
        .update({ bot_paso: guardarEstado({ modo: "pidiendo_nombre", carrito: estado.carrito }) })
        .eq("id", pedido.id);
      await enviarTexto(phoneNumberId, waId, "¿A nombre de quién dejo el pedido?");
      return;
    }
    await finalizarPedido(admin, pedido, estado.carrito, phoneNumberId, waId, sucursalId);
    return;
  }
  if (replyId === "ia_confirmar") {
    if (estado.modo !== "ia_pendiente") return;
    const carrito = fusionarCarritos(estado.carrito, estado.propuesta);
    await guardarCarrito(admin, pedido.id, carrito);
    const { texto, total } = formatearCarrito(carrito, catalogoMap);
    await enviarBotones(phoneNumberId, waId, `Agregado.\n\nTu pedido:\n${texto}\n\nTotal: ${AR.format(total)}`, BOTONES_CARRITO);
    return;
  }
  if (replyId === "ia_cancelar") {
    await guardarCarrito(admin, pedido.id, estado.carrito);
    await enviarTexto(phoneNumberId, waId, "Listo, no lo agregué.");
    return;
  }
  // Id desconocido (ej. un botón de una conversación vieja) -- se ignora en
  // silencio, no rompe el flujo.
}

export async function procesarMensajeBot(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    sucursalId: string;
    phoneNumberId: string;
    waId: string;
    nombrePerfil: string | null;
    texto: string | null;
    interactive?: { button_reply?: { id?: string; title?: string } | null; list_reply?: { id?: string; title?: string } | null } | null;
  }
) {
  const { sucursalId, phoneNumberId, waId, nombrePerfil, texto, interactive } = params;

  const { data: pedidoExistente } = await (admin as any)
    .from("pedidos")
    .select("id, bot_paso, cliente_nombre")
    .eq("cliente_wa_id", waId)
    .eq("sucursal_id", sucursalId)
    .eq("estado", "carrito")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let pedido = pedidoExistente as { id: string; bot_paso: string | null; cliente_nombre: string | null } | null;
  if (!pedido) {
    const { data: nuevo, error } = await (admin as any)
      .from("pedidos")
      .insert({
        sucursal_id: sucursalId,
        origen: "whatsapp",
        estado: "carrito",
        tipo_entrega: "retiro_local",
        cliente_wa_id: waId,
        cliente_telefono: waId,
        cliente_nombre: nombrePerfil ?? null,
        bot_paso: guardarEstado({ modo: "menu", carrito: [] }),
      })
      .select("id, bot_paso, cliente_nombre")
      .single();
    if (error || !nuevo) {
      console.error("[bot-whatsapp] no se pudo crear el pedido:", error?.message);
      return;
    }
    pedido = nuevo as { id: string; bot_paso: string | null; cliente_nombre: string | null };
  }

  const estado = leerEstado(pedido.bot_paso);
  const replyId = interactive?.button_reply?.id ?? interactive?.list_reply?.id ?? null;

  const catalogo = await cargarCatalogo(admin, sucursalId);
  const catalogoMap = new Map(catalogo.todosLosItems.map((i) => [i.id, i]));

  if (estado.modo === "pidiendo_nombre" && !replyId && texto?.trim()) {
    const nombre = texto.trim();
    await (admin as any).from("pedidos").update({ cliente_nombre: nombre }).eq("id", pedido.id);
    await finalizarPedido(admin, { id: pedido.id, cliente_nombre: nombre }, estado.carrito, phoneNumberId, waId, sucursalId);
    return;
  }

  if (replyId) {
    await manejarRespuestaInteractiva(admin, pedido, estado, replyId, catalogo, catalogoMap, phoneNumberId, waId, sucursalId);
    return;
  }

  if (texto?.trim()) {
    const propuesta = await interpretarPedidoConIA(
      texto,
      catalogo.todosLosItems.map((i) => ({ id: i.id, name: i.name, price: i.price, esPromo: i.esPromo }))
    );
    if (propuesta.length > 0) {
      const propuestaCarrito: ItemCarrito[] = propuesta.map((p) => ({ id: p.id, esPromo: p.esPromo, cantidad: p.cantidad }));
      await (admin as any).from("pedidos")
        .update({ bot_paso: guardarEstado({ modo: "ia_pendiente", carrito: estado.carrito, propuesta: propuestaCarrito }) })
        .eq("id", pedido.id);
      const { texto: detalle } = formatearCarrito(propuestaCarrito, catalogoMap);
      await enviarBotones(phoneNumberId, waId, `Entendí esto:\n${detalle}\n\n¿Lo agrego a tu pedido?`, [
        { id: "ia_confirmar", title: "Sí, agregar" },
        { id: "ia_cancelar", title: "No" },
      ]);
      return;
    }
  }

  await mandarCategorias(phoneNumberId, waId, catalogo);
}
