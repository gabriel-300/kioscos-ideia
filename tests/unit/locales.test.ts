import { describe, it, expect } from "vitest";
import { armarLocales, cargarLocalesParaPedir, leerCoordenadasSucursal } from "@/lib/pedidos/locales";
import { fakeAdmin } from "../helpers/fake-supabase";
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

describe("armarLocales: coordenadas (migración 100)", () => {
  it("con coordenadas las expone como número (aunque lleguen como texto)", () => {
    expect(armarLocales([fila({ latitud: "-27.366512", longitud: -55.896423 })])[0]).toMatchObject({ latitud: -27.366512, longitud: -55.896423 });
  });
  it("sin las columnas, null o basura = sin coordenadas", () => {
    for (const over of [{}, { latitud: null, longitud: null }, { latitud: "abc", longitud: "" }]) {
      expect(armarLocales([fila(over)])[0]).toMatchObject({ latitud: null, longitud: null });
    }
  });
});

describe("cargarLocalesParaPedir: tolerante a la migración 100", () => {
  it("con las columnas, devuelve las coordenadas", async () => {
    const { admin } = fakeAdmin(() => ({ data: [fila({ latitud: -27.3, longitud: -55.9 })] }));
    expect((await cargarLocalesParaPedir(admin))[0]).toMatchObject({ latitud: -27.3, longitud: -55.9 });
  });
  it("si la consulta con latitud/longitud falla, reintenta sin ellas y responde sin coordenadas", async () => {
    let n = 0;
    const { admin } = fakeAdmin(() => (++n === 1 ? { error: { message: "column sucursales.latitud does not exist" } } : { data: [fila()] }));
    const r = await cargarLocalesParaPedir(admin);
    expect(n).toBe(2);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "s1", latitud: null, longitud: null });
  });
  it("leerCoordenadasSucursal: par completo, o null si falta una o falla la consulta", async () => {
    expect(await leerCoordenadasSucursal(fakeAdmin(() => ({ data: { latitud: "-27.3", longitud: "-55.9" } })).admin, "s1")).toEqual({ lat: -27.3, lng: -55.9 });
    expect(await leerCoordenadasSucursal(fakeAdmin(() => ({ data: { latitud: -27.3, longitud: null } })).admin, "s1")).toBeNull();
    expect(await leerCoordenadasSucursal(fakeAdmin(() => ({ error: { message: "x" } })).admin, "s1")).toBeNull();
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
