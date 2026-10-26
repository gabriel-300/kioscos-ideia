import { describe, it, expect } from "vitest";
import { escribirEnChat, leerChat, normalizarTexto, sinLeerPorPedido, MAX_TEXTO, MAX_POR_VENTANA, MAX_MENSAJES_POR_PEDIDO } from "@/lib/pedidos/chat";
import { fakeAdmin, eqDe, type Q } from "../helpers/fake-supabase";

const PEDIDO = "11111111-1111-4111-8111-111111111111";

type Opciones = {
  estado?: string;
  repartidorId?: string | null;
  mensajes?: any[];
  total?: number;
  recientes?: number;
  tieneSucursal?: boolean; // vendedor con la sucursal asignada
  errorInsert?: any;
};

// Base falsa con un pedido y su hilo.
function base(o: Opciones = {}) {
  return fakeAdmin((q: Q) => {
    if (q.table === "pedidos") return { data: { id: PEDIDO, sucursal_id: "s1", estado: o.estado ?? "confirmado", repartidor_id: o.repartidorId ?? null } };
    if (q.table === "profile_sucursales") return { data: o.tieneSucursal === false ? null : { id: "x" } };
    if (q.table === "pedido_mensajes") {
      if (q.op === "insert") return { error: o.errorInsert };
      if (q.head) {
        const conVentana = q.filters.some((f) => f.op === "gte");
        return { count: conVentana ? (o.recientes ?? 0) : (o.total ?? 0) };
      }
      return { data: o.mensajes ?? [] };
    }
    return undefined;
  });
}

const cliente = { tipo: "cliente" } as const;
const admin = { tipo: "personal", userId: "u-admin", role: "admin" } as const;
const vendedor = { tipo: "personal", userId: "u-v", role: "vendedor" } as const;
const repartidor = { tipo: "repartidor", userId: "r1", role: "repartidor" } as const;

describe("normalizarTexto", () => {
  it("recorta, limpia caracteres de control y rechaza vacío o largo", () => {
    expect(normalizarTexto("  hola\u0000 \r\n\r\n\r\n\r\nchau ").texto).toBe("hola \n\nchau");
    expect(normalizarTexto("   ").error).toBeTruthy();
    expect(normalizarTexto(42 as any).error).toBeTruthy();
    expect(normalizarTexto("a".repeat(MAX_TEXTO)).texto).toHaveLength(MAX_TEXTO);
    expect(normalizarTexto("a".repeat(MAX_TEXTO + 1)).error).toMatch(/largo/);
  });
  it("deja el texto tal cual (React lo escapa): no interpreta HTML", () => {
    expect(normalizarTexto("<b>hola</b>").texto).toBe("<b>hola</b>");
  });
});

describe("cliente", () => {
  it("escribe en su pedido: queda como 'cliente', sin user_id", async () => {
    const { admin: a, calls } = base();
    expect(await escribirEnChat(a, cliente, PEDIDO, "Hola, toco timbre")).toEqual({});
    const ins = calls.find((c) => c.op === "insert")!;
    expect(ins.payload).toEqual({ pedido_id: PEDIDO, autor: "cliente", user_id: null, texto: "Hola, toco timbre" });
  });
  it("un pedido que no existe o es un carrito no se puede leer ni escribir", async () => {
    const sin = fakeAdmin(() => ({ data: null }));
    expect(await leerChat(sin.admin, cliente, PEDIDO)).toEqual({ error: "No se encontró el pedido" });
    const carrito = base({ estado: "carrito" });
    expect(await escribirEnChat(carrito.admin, cliente, PEDIDO, "hola")).toEqual({ error: "No se encontró el pedido" });
  });
  it("lee el hilo con etiquetas, 'propio' según quién mira, y marca como leído lo del otro lado", async () => {
    const { admin: a, rpcCalls } = base({
      mensajes: [
        { id: "m1", autor: "local", texto: "Ya sale", created_at: "2026-10-23T10:00:00Z", leido_por: [] },
        { id: "m2", autor: "cliente", texto: "Gracias", created_at: "2026-10-23T10:01:00Z", leido_por: [] },
      ],
    });
    const r = await leerChat(a, cliente, PEDIDO);
    if ("error" in r) throw new Error(r.error);
    expect(r.mensajes.map((m) => [m.autor, m.propio])).toEqual([["local", false], ["cliente", true]]);
    expect(r.puedeEscribir).toBe(true);
    expect(rpcCalls).toEqual([{ name: "chat_marcar_leidos", args: { p_pedido: PEDIDO, p_lector: "cliente" } }]);
  });
  it("no devuelve teléfono ni datos del pedido: solo id, autor, texto, hora y propio", async () => {
    const { admin: a } = base({ mensajes: [{ id: "m1", autor: "local", texto: "x", created_at: "2026-10-23T10:00:00Z", leido_por: [], user_id: "u-secreto" }] });
    const r = await leerChat(a, cliente, PEDIDO);
    if ("error" in r) throw new Error(r.error);
    expect(Object.keys(r.mensajes[0]).sort()).toEqual(["autor", "creado", "id", "propio", "texto"]);
  });
  it("sin mensajes nuevos del otro lado no llama a marcar leídos", async () => {
    const { admin: a, rpcCalls } = base({ mensajes: [{ id: "m1", autor: "local", texto: "x", created_at: "t", leido_por: ["cliente"] }] });
    await leerChat(a, cliente, PEDIDO);
    expect(rpcCalls).toEqual([]);
  });
});

describe("solo lectura al cerrar el pedido", () => {
  for (const estado of ["entregado", "cancelado"]) {
    it(`${estado}: se lee pero no se escribe (cliente y personal)`, async () => {
      const { admin: a, calls } = base({ estado, mensajes: [{ id: "m1", autor: "local", texto: "x", created_at: "t", leido_por: [] }] });
      const r = await leerChat(a, cliente, PEDIDO);
      if ("error" in r) throw new Error(r.error);
      expect(r.mensajes).toHaveLength(1);
      expect(r.puedeEscribir).toBe(false);
      expect(r.aviso).toMatch(/terminó/);
      expect((await escribirEnChat(a, cliente, PEDIDO, "hola")).error).toMatch(/terminó/);
      expect((await escribirEnChat(a, admin, PEDIDO, "hola")).error).toMatch(/terminó/);
      expect(calls.some((c) => c.op === "insert")).toBe(false);
    });
  }
  it("un pedido vencido tampoco admite mensajes nuevos", async () => {
    const { admin: a } = base({ estado: "expirado" });
    expect((await escribirEnChat(a, cliente, PEDIDO, "hola")).error).toMatch(/venció/);
  });
});

describe("personal del local", () => {
  it("un admin escribe como 'local' con su user_id", async () => {
    const { admin: a, calls } = base();
    expect(await escribirEnChat(a, admin, PEDIDO, "Estamos en camino")).toEqual({});
    expect(calls.find((c) => c.op === "insert")!.payload).toMatchObject({ autor: "local", user_id: "u-admin" });
  });
  it("un vendedor sin esa sucursal no lee ni escribe", async () => {
    const { admin: a, calls } = base({ tieneSucursal: false });
    expect(await leerChat(a, vendedor, PEDIDO)).toEqual({ error: "No tenés permisos para esta sucursal" });
    expect((await escribirEnChat(a, vendedor, PEDIDO, "hola")).error).toMatch(/permisos/);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });
  it("un vendedor con la sucursal asignada sí", async () => {
    const { admin: a } = base({ tieneSucursal: true });
    expect(await escribirEnChat(a, vendedor, PEDIDO, "hola")).toEqual({});
  });
});

describe("repartidor", () => {
  it("escribe solo en un pedido suyo que está en reparto", async () => {
    const { admin: a, calls } = base({ estado: "en_reparto", repartidorId: "r1" });
    expect(await escribirEnChat(a, repartidor, PEDIDO, "Llego en 5")).toEqual({});
    expect(calls.find((c) => c.op === "insert")!.payload).toMatchObject({ autor: "repartidor", user_id: "r1" });
  });
  it("en un pedido de otro repartidor, no", async () => {
    const { admin: a, calls } = base({ estado: "en_reparto", repartidorId: "otro" });
    expect(await leerChat(a, repartidor, PEDIDO)).toEqual({ error: "Este pedido no es tuyo" });
    expect((await escribirEnChat(a, repartidor, PEDIDO, "hola")).error).toBe("Este pedido no es tuyo");
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });
  it("si el pedido no está en reparto (todavía o ya entregado), no entra", async () => {
    for (const estado of ["en_preparacion", "entregado", "cancelado"]) {
      const { admin: a } = base({ estado, repartidorId: "r1" });
      expect("error" in (await leerChat(a, repartidor, PEDIDO))).toBe(true);
      expect((await escribirEnChat(a, repartidor, PEDIDO, "hola")).error).toMatch(/en reparto/);
    }
  });
  it("un admin que supervisa desde Mis entregas escribe como 'local', no como repartidor", async () => {
    const { admin: a, calls } = base({ estado: "en_reparto", repartidorId: "r1" });
    await escribirEnChat(a, { tipo: "repartidor", userId: "u-admin", role: "admin" }, PEDIDO, "hola");
    expect(calls.find((c) => c.op === "insert")!.payload.autor).toBe("local");
  });
  it("un rol que no reparte (concesionario) queda afuera", async () => {
    const { admin: a } = base({ estado: "en_reparto", repartidorId: "x" });
    expect((await escribirEnChat(a, { tipo: "repartidor", userId: "x", role: "concesionario" }, PEDIDO, "hola")).error).toBe("Sin permisos");
  });
  it("un vendedor que reparte puede escribir en SU envío, como repartidor, y no en el de otro", async () => {
    const suyo = base({ estado: "en_reparto", repartidorId: "v1" });
    expect((await escribirEnChat(suyo.admin, { tipo: "repartidor", userId: "v1", role: "vendedor" }, PEDIDO, "ya voy")).error).toBeUndefined();
    expect(suyo.calls.find((c) => c.op === "insert")!.payload.autor).toBe("repartidor");
    const ajeno = base({ estado: "en_reparto", repartidorId: "otro" });
    expect((await escribirEnChat(ajeno.admin, { tipo: "repartidor", userId: "v1", role: "vendedor" }, PEDIDO, "hola")).error).toBe("Este pedido no es tuyo");
  });
});

describe("límites", () => {
  it("rechaza texto vacío o de más de 500 letras sin tocar la base", async () => {
    const { admin: a, calls } = base();
    expect((await escribirEnChat(a, cliente, PEDIDO, "  ")).error).toBeTruthy();
    expect((await escribirEnChat(a, cliente, PEDIDO, "x".repeat(501))).error).toMatch(/largo/);
    expect(calls).toHaveLength(0);
  });
  it("frena el spam: más de N mensajes por minuto del mismo lado", async () => {
    const { admin: a, calls } = base({ recientes: MAX_POR_VENTANA });
    expect((await escribirEnChat(a, cliente, PEDIDO, "hola")).error).toMatch(/muy rápido/);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
    // el conteo es por lado: se pregunta por el autor correcto
    const conteo = calls.find((c) => c.head && c.filters.some((f) => f.op === "gte"))!;
    expect(eqDe(conteo, "autor")).toBe("cliente");
    expect(eqDe(conteo, "pedido_id")).toBe(PEDIDO);
  });
  it("tope de mensajes por pedido", async () => {
    const { admin: a } = base({ total: MAX_MENSAJES_POR_PEDIDO });
    expect((await escribirEnChat(a, admin, PEDIDO, "hola")).error).toMatch(/máximo/);
  });
  it("si falta la migración lo dice; otro error no filtra detalles internos", async () => {
    const sinTabla = base({ errorInsert: { message: 'relation "pedido_mensajes" does not exist' } });
    expect((await escribirEnChat(sinTabla.admin, cliente, PEDIDO, "hola")).error).toMatch(/migración 124/);
    const otro = base({ errorInsert: { message: "boom interno" } });
    expect((await escribirEnChat(otro.admin, cliente, PEDIDO, "hola")).error).toBe("No se pudo enviar el mensaje");
  });
});

describe("sinLeerPorPedido", () => {
  it("cuenta lo del otro lado que el local no leyó, por pedido", async () => {
    const { admin: a, calls } = fakeAdmin(() => ({
      data: [
        { pedido_id: "p1", leido_por: [] },
        { pedido_id: "p1", leido_por: ["cliente"] },
        { pedido_id: "p1", leido_por: ["local"] },
        { pedido_id: "p2", leido_por: null },
      ],
    }));
    const m = await sinLeerPorPedido(a, ["p1", "p2"]);
    expect(m.get("p1")).toBe(2);
    expect(m.get("p2")).toBe(1);
    expect(calls[0].filters.find((f) => f.op === "neq")).toMatchObject({ col: "autor", val: "local" });
  });
  it("sin pedidos no consulta", async () => {
    const { admin: a, calls } = fakeAdmin(() => ({ data: [] }));
    expect((await sinLeerPorPedido(a, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
