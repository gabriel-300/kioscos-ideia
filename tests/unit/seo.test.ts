import { describe, it, expect } from "vitest";
import { descripcionLocal, horarioSchema, jsonLdLocal, jsonLdMarca, nombreLimpio, rutaLocal, slugDeSucursal, telefonoInternacional, SITIO } from "@/lib/pedidos/seo";
import { slugDeRutaCorta } from "@/lib/dominios";
import { resolverSucursalId } from "@/lib/pedidos/seo-servidor";
import { fakeAdmin } from "../helpers/fake-supabase";

const UNAM = { nombre: "Angiru Food UNAM ", direccion: "Ruta 12 km 7", localidad: "Posadas", telefono: "3764255000",
  horario: [1, 2, 3, 4, 5].map((dia) => ({ dia, abre: "07:00", cierra: "19:30" })), latitud: -27.4, longitud: -55.9 };

describe("direcciones cortas", () => {
  it("el slug sale del nombre del local", () => {
    expect(slugDeSucursal("Angiru Food UNAM ")).toBe("unam");
    expect(slugDeSucursal("Angiru Food Costanera")).toBe("costanera");
    expect(slugDeSucursal("Angiru Food Parque de las Fiestas")).toBe("parque-de-las-fiestas");
    expect(slugDeSucursal("Angiru Food Misión Ñandú")).toBe("mision-nandu");
    expect(slugDeSucursal("Angiru Food")).toBe("angiru-food");
    expect(rutaLocal("Angiru Food UNAM")).toBe("/unam");
  });
  it("limpia los espacios de más del nombre", () => {
    expect(nombreLimpio("  Angiru   Food UNAM ")).toBe("Angiru Food UNAM");
  });
  it("solo una palabra después de la barra, y nunca una zona de la aplicación", () => {
    expect(slugDeRutaCorta("/unam")).toBe("unam");
    expect(slugDeRutaCorta("/unam/")).toBe("unam");
    expect(slugDeRutaCorta("/parque-de-las-fiestas")).toBe("parque-de-las-fiestas");
    for (const p of ["/", "/admin", "/tenteo", "/login", "/api", "/auth", "/pedir", "/privacidad", "/terminos", "/elegir-sistema", "/registro", "/forgot-password", "/google1078902f8b578bc8.html", "/sitemap.xml", "/robots.txt", "/favicon.ico", "/unam/algo", "/Unam", "/_next", "/-x"]) {
      expect(slugDeRutaCorta(p), p).toBeNull();
    }
  });
});

describe("resolverSucursalId", () => {
  const UUID = "4af1ad9f-cd2f-47cd-974d-2bc8037db9a4";
  it("un uuid pasa tal cual, sin consultar", async () => {
    const f = fakeAdmin(() => ({ data: [] }));
    expect(await resolverSucursalId(f.admin, UUID)).toBe(UUID);
    expect(f.calls).toHaveLength(0);
  });
  it("la dirección corta se resuelve entre los locales habilitados; una desconocida da null", async () => {
    const f = fakeAdmin(() => ({ data: [{ id: UUID, nombre: "Angiru Food UNAM ", direccion: null, localidad: null, whatsapp_pedidos: null, horario_pedidos: null }] }));
    expect(await resolverSucursalId(f.admin, "unam")).toBe(UUID);
    expect(await resolverSucursalId(f.admin, "UNAM")).toBe(UUID);
    expect(await resolverSucursalId(f.admin, "costanera")).toBeNull();
  });
});

describe("datos estructurados", () => {
  it("teléfono en formato internacional", () => {
    expect(telefonoInternacional("3764255000")).toBe("+543764255000");
    expect(telefonoInternacional("+54 9 376 536-6312")).toBe("+5493765366312");
    expect(telefonoInternacional("123")).toBeUndefined();
    expect(telefonoInternacional(null)).toBeUndefined();
  });
  it("horario como lo pide schema.org", () => {
    expect(horarioSchema(UNAM.horario)?.[0]).toEqual({ "@type": "OpeningHoursSpecification", dayOfWeek: "Monday", opens: "07:00", closes: "19:30" });
    expect(horarioSchema(null)).toBeUndefined();
    expect(horarioSchema([])).toBeUndefined();
  });
  it("el local: panadería con dirección, teléfono, horario, ubicación y enlace para pedir", () => {
    const j = jsonLdLocal(UNAM) as any;
    expect(j["@type"]).toBe("Bakery");
    expect(j.name).toBe("Angiru Food UNAM");
    expect(j.url).toBe(`${SITIO}/unam`);
    expect(j.telephone).toBe("+543764255000");
    expect(j.address).toMatchObject({ streetAddress: "Ruta 12 km 7", addressLocality: "Posadas", addressRegion: "Misiones", addressCountry: "AR" });
    expect(j.geo).toEqual({ "@type": "GeoCoordinates", latitude: -27.4, longitude: -55.9 });
    expect(j.openingHoursSpecification).toHaveLength(5);
    expect(j.potentialAction.target).toBe(`${SITIO}/unam`);
  });
  it("sin teléfono, horario ni coordenadas no inventa nada", () => {
    const j = jsonLdLocal({ ...UNAM, telefono: null, horario: null, latitud: null, longitud: null }) as any;
    expect(j).not.toHaveProperty("telephone");
    expect(j).not.toHaveProperty("geo");
    expect(j).not.toHaveProperty("openingHoursSpecification");
  });
  it("la marca y la descripción del local", () => {
    expect((jsonLdMarca() as any)["@type"]).toBe("Organization");
    expect(descripcionLocal(UNAM)).toMatch(/Angiru Food UNAM \(Ruta 12 km 7\)/);
  });
});
