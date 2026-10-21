import { describe, it, expect } from "vitest";
import { filtrarYOrdenar, resumirClientes, totalesClientes, type ClienteFila, type PedidoDeCliente } from "@/lib/pedidos/clientes-resumen";

const clientes: ClienteFila[] = [
  { id: "a", nombre: "Ana Pérez", telefono: "3764123456", created_at: "2026-10-01T10:00:00Z" },
  { id: "b", nombre: "Beto", telefono: null, created_at: "2026-10-05T10:00:00Z" },
  { id: "c", nombre: null, telefono: "+54 9 376 400-0000", created_at: "2026-10-10T10:00:00Z" },
];
const ped = (cliente_id: string, total: number | string, estado: string, created_at: string): PedidoDeCliente => ({ cliente_id, total, estado, created_at });
const pedidos: PedidoDeCliente[] = [
  ped("a", 10000, "entregado", "2026-10-02T12:00:00Z"),
  ped("a", "5000.00", "pagado", "2026-10-08T12:00:00Z"),
  ped("a", 9999, "cancelado", "2026-10-09T12:00:00Z"),        // no cuenta
  ped("a", 3000, "pendiente_pago", "2026-10-09T13:00:00Z"),   // no cuenta
  ped("b", 2000, "expirado", "2026-10-06T12:00:00Z"),         // no cuenta
];
const emails = new Map([["a", "ana@gmail.com"]]);

describe("resumirClientes", () => {
  const r = resumirClientes(clientes, pedidos, emails);
  const de = (id: string) => r.find((x) => x.id === id)!;

  it("cuenta solo los pedidos que se compraron de verdad y suma lo gastado (el total puede venir como texto)", () => {
    expect(de("a")).toMatchObject({ pedidos: 2, gastado: 15000, primerPedido: "2026-10-02T12:00:00Z", ultimoPedido: "2026-10-08T12:00:00Z" });
  });
  it("un cliente sin pedidos válidos queda en cero, con fechas vacías", () => {
    expect(de("b")).toMatchObject({ pedidos: 0, gastado: 0, primerPedido: null, ultimoPedido: null });
  });
  it("trae el mail de la cuenta cuando lo hay y deja el teléfono y el nombre vacíos como null", () => {
    expect(de("a").email).toBe("ana@gmail.com");
    expect(de("b").email).toBeNull();
    expect(de("c").nombre).toBeNull();
  });
});

describe("totalesClientes", () => {
  it("registrados, los que ya compraron, los que volvieron y lo vendido", () => {
    const t = totalesClientes(resumirClientes(clientes, pedidos, emails));
    expect(t).toEqual({ registrados: 3, conPedidos: 1, recurrentes: 1, pedidos: 2, gastado: 15000 });
  });
});

describe("filtrarYOrdenar", () => {
  const r = resumirClientes(clientes, pedidos, emails);
  it("busca por nombre sin tildes ni mayúsculas", () => {
    expect(filtrarYOrdenar(r, "perez", "gastado").map((x) => x.id)).toEqual(["a"]);
  });
  it("busca por mail y por teléfono (solo dígitos, aunque venga con +54 y guiones)", () => {
    expect(filtrarYOrdenar(r, "ana@gmail", "gastado").map((x) => x.id)).toEqual(["a"]);
    expect(filtrarYOrdenar(r, "400-0000", "gastado").map((x) => x.id)).toEqual(["c"]);
  });
  it("ordena por lo gastado, por pedidos, por la compra más reciente y por alta", () => {
    expect(filtrarYOrdenar(r, "", "gastado")[0].id).toBe("a");
    expect(filtrarYOrdenar(r, "", "pedidos")[0].id).toBe("a");
    expect(filtrarYOrdenar(r, "", "reciente")[0].id).toBe("a");
    expect(filtrarYOrdenar(r, "", "nuevos").map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
  it("no modifica la lista original", () => {
    const copia = r.map((x) => x.id);
    filtrarYOrdenar(r, "", "nuevos");
    expect(r.map((x) => x.id)).toEqual(copia);
  });
});
