import { describe, it, expect } from "vitest";
import { armarLocales } from "@/lib/pedidos/locales";
import { DOMINIO_CLIENTES, esDominioClientes, esDominioClientesSinWww, hostSinPuerto } from "@/lib/dominios";

const fila = (over: Record<string, unknown> = {}) => ({
  id: "s1", nombre: "Parque de las Fiestas", direccion: "Av. Costanera 123", localidad: "Posadas",
  horario_pedidos: null, delivery_habilitado: false, retiro_habilitado: true, ...over,
});

describe("armarLocales", () => {
  it("sin horario cargado el local figura siempre abierto", () => {
    expect(armarLocales([fila()])[0]).toMatchObject({ id: "s1", abierto: true, conRetiro: true, conEnvio: false });
  });
  it("con horario, usa el estado real (hora argentina) y dice cuándo abre", () => {
    const cerrado = Array.from({ length: 7 }, (_, dia) => ({ dia, abre: "08:00", cierra: "09:00" }));
    // 18:00 UTC = 15:00 en Argentina: todos los días cierra a las 9
    const [l] = armarLocales([fila({ horario_pedidos: cerrado })], new Date("2026-09-19T18:00:00Z"));
    expect(l.abierto).toBe(false);
    expect(l.proximaApertura).toBeTruthy();
  });
  it("envío y retiro salen de la configuración de cada local", () => {
    const [a, b] = armarLocales([fila({ delivery_habilitado: true }), fila({ id: "s2", retiro_habilitado: false })]);
    expect(a.conEnvio).toBe(true);
    expect(b.conRetiro).toBe(false);
  });
  it("sin dirección o localidad no rompe", () => {
    expect(armarLocales([fila({ direccion: null, localidad: null })])[0]).toMatchObject({ direccion: null, localidad: null });
  });
  it("sin filas devuelve una lista vacía", () => {
    expect(armarLocales([])).toEqual([]);
  });
});

describe("dominios", () => {
  it("normaliza mayúsculas y puerto", () => {
    expect(hostSinPuerto("WWW.AngiruFood.com.ar:443")).toBe("www.angirufood.com.ar");
    expect(hostSinPuerto(null)).toBe("");
  });
  it("reconoce el dominio de clientes y su versión sin www, y nada parecido", () => {
    expect(esDominioClientes(DOMINIO_CLIENTES)).toBe(true);
    expect(esDominioClientesSinWww("angirufood.com.ar")).toBe(true);
    for (const h of ["", "angirufood.com", "www.angirufood.com.ar.evil.com", "kioscos-ideia.lytwyn-ideia.workers.dev"]) {
      expect(esDominioClientes(h)).toBe(false);
      expect(esDominioClientesSinWww(h)).toBe(false);
    }
  });
});
