import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";
import { armarSeguimiento, esEstadoFinal } from "@/lib/pedidos/seguimiento";
import { textoCambioEstado, notificarCambioEstado } from "@/lib/pedidos/notificar-cliente";
import { urlSeguimiento, urlCatalogo } from "@/lib/pedidos/enlaces";

const wa = vi.hoisted(() => ({ enviarTexto: vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; error?: string }> => ({ ok: true })) }));
vi.mock("@/lib/whatsapp/enviar-mensaje", () => wa);

const ped = (estado: string, tipo = "retiro_local", medio: string | null = "efectivo") => ({ estado, tipo_entrega: tipo, medio_pago: medio });
const estados = (p: ReturnType<typeof ped>) => armarSeguimiento(p).pasos.map((x) => `${x.clave}:${x.estado}`);

describe("armarSeguimiento", () => {
  it("efectivo + retiro: recibido → preparación → listo para retirar → entregado", () => {
    expect(estados(ped("confirmado"))).toEqual(["recibido:actual", "preparando:pendiente", "salida:pendiente", "entregado:pendiente"]);
    expect(estados(ped("en_preparacion"))).toEqual(["recibido:hecho", "preparando:actual", "salida:pendiente", "entregado:pendiente"]);
    expect(armarSeguimiento(ped("listo_retiro")).pasos[2].label).toBe("Listo para retirar");
  });
  it("delivery: el tercer paso es 'En camino'", () => {
    const s = armarSeguimiento(ped("en_reparto", "delivery"));
    expect(s.pasos[2]).toMatchObject({ label: "En camino", estado: "actual" });
  });
  it("Mercado Pago por link suma el paso 'Pago' al principio", () => {
    expect(estados(ped("pendiente_pago", "retiro_local", "mercadopago_link"))[0]).toBe("pago:actual");
    expect(estados(ped("pagado", "retiro_local", "mercadopago_link")).slice(0, 2)).toEqual(["pago:hecho", "recibido:actual"]);
  });
  it("entregado deja todos los pasos completos y el seguimiento termina", () => {
    const s = armarSeguimiento(ped("entregado"));
    expect(s.pasos.every((x) => x.estado === "hecho")).toBe(true);
    expect(s.final).toBe(true);
  });
  it("cancelado y vencido no tienen pasos y son finales", () => {
    for (const e of ["cancelado", "expirado"]) {
      const s = armarSeguimiento(ped(e));
      expect(s.pasos).toEqual([]);
      expect(s.final).toBe(true);
    }
    expect(esEstadoFinal("en_preparacion")).toBe(false);
  });
  it("un estado desconocido no rompe la página", () => {
    expect(armarSeguimiento(ped("inventado")).titulo).toMatch(/procesando/i);
  });
});

describe("enlaces", () => {
  it("el seguimiento cuelga del catálogo de la sucursal", () => {
    expect(urlSeguimiento("s1", "p1")).toBe(`${urlCatalogo("s1")}/pedido/p1`);
    expect(urlCatalogo("s1")).toMatch(/^https:\/\/.+\/pedir\/s1$/);
  });
});

describe("avisos al cliente por WhatsApp", () => {
  const p = (estado: string) => ({ numero: 7, estado, tipo_entrega: "retiro_local", medio_pago: "efectivo" });

  it("avisan los cambios que le importan al cliente y llevan el enlace", () => {
    for (const e of ["pagado", "en_preparacion", "listo_retiro", "en_reparto", "cancelado"]) {
      const t = textoCambioEstado(p(e), "https://x/seg");
      expect(t).toContain("#7");
      expect(t).toContain("https://x/seg");
    }
  });
  it("no avisan lo que ya sabe o no aporta (recibido, entregado, vencido)", () => {
    for (const e of ["confirmado", "pendiente_pago", "entregado", "expirado"]) expect(textoCambioEstado(p(e), "https://x")).toBeNull();
  });

  describe("notificarCambioEstado", () => {
    const mundo = (fila: Record<string, unknown> | null) => fakeAdmin((q: Q) => {
      if (q.table === "pedidos") return { data: fila };
    });
    const base = { origen: "whatsapp", cliente_wa_id: "5493764000000", estado: "en_preparacion", numero: 7, tipo_entrega: "retiro_local", medio_pago: "efectivo", sucursal_id: "s1", sucursales: { whatsapp_phone_number_id: "pn1" } };

    beforeEach(() => { wa.enviarTexto.mockClear(); process.env.WHATSAPP_ACCESS_TOKEN = "t"; vi.spyOn(console, "error").mockImplementation(() => {}); });
    afterEach(() => { delete process.env.WHATSAPP_ACCESS_TOKEN; vi.restoreAllMocks(); });

    it("un pedido del bot recibe el aviso en su chat", async () => {
      await notificarCambioEstado(mundo(base).admin, "ped-1");
      expect(wa.enviarTexto).toHaveBeenCalledTimes(1);
      expect(wa.enviarTexto.mock.calls[0].slice(0, 2)).toEqual(["pn1", "5493764000000"]);
    });
    it("un pedido de la tienda web NO recibe nada (no se puede escribir sin plantilla)", async () => {
      await notificarCambioEstado(mundo({ ...base, origen: "storefront", cliente_wa_id: null }).admin, "ped-1");
      expect(wa.enviarTexto).not.toHaveBeenCalled();
    });
    it("sin credenciales de WhatsApp ni siquiera consulta la base", async () => {
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      const { admin, calls } = mundo(base);
      await notificarCambioEstado(admin, "ped-1");
      expect(calls).toHaveLength(0);
    });
    it("si el envío falla no lanza (el cambio de estado ya está guardado)", async () => {
      wa.enviarTexto.mockResolvedValueOnce({ ok: false, error: "boom" });
      await expect(notificarCambioEstado(mundo(base).admin, "ped-1")).resolves.toBeUndefined();
    });
  });
});
