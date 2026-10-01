import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fakeAdmin, eqDe, type Q } from "../helpers/fake-supabase";
import { puertoKiosco } from "@/lib/tenteo/puerto-kiosco";

// El puerto es lo único que Tenteo toma del kiosco: catálogo, stock, registrar
// la venta y a qué sucursales mira cada persona. Estas pruebas fijan QUÉ se le
// pide a la base (las mismas consultas que antes estaban repartidas en
// lib/pedidos) y que nadie de Tenteo se salte la frontera.

const SUC = "suc-1";

describe("puerto: catálogo y restricciones", () => {
  it("restricciones: lee las dos columnas de la sucursal; por defecto sin restricción y promos habilitadas", async () => {
    const f = fakeAdmin(() => ({ data: { categorias_habilitadas: ["c1"], promos_habilitadas: false } }));
    expect(await puertoKiosco(f.admin).restricciones(SUC)).toEqual({ categoriasHabilitadas: ["c1"], promosHabilitadas: false });
    expect(eqDe(f.calls[0], "id")).toBe(SUC);

    const vacia = fakeAdmin(() => ({ data: null }));
    expect(await puertoKiosco(vacia.admin).restricciones(SUC)).toEqual({ categoriasHabilitadas: null, promosHabilitadas: true });
  });

  it("datosCatalogo: pide categorías, productos (sin MULTA-TERMO), precios, promos, stock y componentes", async () => {
    const f = fakeAdmin((q: Q) => {
      if (q.table === "products") return { data: [{ id: "p1" }] };
      if (q.table === "product_prices") return { data: [{ product_id: "p1", precio_dist: 10 }] };
      if (q.table === "stock_sucursal") return { data: [{ product_id: "p1", stock_actual: 3 }], count: 1 };
    });
    const d = await puertoKiosco(f.admin).datosCatalogo(SUC);
    expect(f.calls.map((c) => c.table).sort()).toEqual(
      ["categories", "product_prices", "products", "promo_items", "promo_prices", "promos", "stock_sucursal"],
    );
    const productos = f.calls.find((c) => c.table === "products")!;
    expect(productos.filters).toEqual(expect.arrayContaining([{ op: "eq", col: "is_active", val: true }, { op: "neq", col: "sku", val: "MULTA-TERMO" }]));
    for (const t of ["product_prices", "promo_prices", "stock_sucursal"]) {
      expect(eqDe(f.calls.find((c) => c.table === t)!, "sucursal_id"), t).toBe(SUC);
    }
    expect(d.productos).toEqual([{ id: "p1" }]);
    expect(d.preciosProducto).toEqual([{ product_id: "p1", precio_dist: 10 }]);
    expect(d.stock).toEqual([{ product_id: "p1", stock_actual: 3 }]);
    expect(d.promos).toEqual([]); // sin datos: lista vacía, no null
  });

  it("si el stock no se puede leer, el catálogo igual se arma (se muestra todo)", async () => {
    const f = fakeAdmin((q: Q) => (q.table === "stock_sucursal" ? { error: { message: "boom" } } : undefined));
    const d = await puertoKiosco(f.admin).datosCatalogo(SUC);
    expect(d.stock).toEqual([]);
  });
});

describe("puerto: datos para validar un carrito", () => {
  it("datosProductos: productos por id y precios de ESA sucursal", async () => {
    const f = fakeAdmin((q: Q) => {
      if (q.table === "products") return { data: [{ id: "p1", category_id: null, is_active: true, vendible_pos: null }] };
      if (q.table === "product_prices") return { data: [{ product_id: "p1", precio_dist: 50 }] };
    });
    const r = await puertoKiosco(f.admin).datosProductos(SUC, ["p1"]);
    expect(r).toEqual({ productos: [{ id: "p1", category_id: null, is_active: true, vendible_pos: null }], precios: [{ product_id: "p1", precio_dist: 50 }] });
    const precios = f.calls.find((c) => c.table === "product_prices")!;
    expect(eqDe(precios, "sucursal_id")).toBe(SUC);
    expect(precios.filters).toEqual(expect.arrayContaining([{ op: "in", col: "product_id", val: ["p1"], extra: undefined }]));
  });
  it("datosProductos: un error de la base se devuelve como { error } (el primero que ocurra)", async () => {
    const f = fakeAdmin((q: Q) => (q.table === "products" ? { error: { message: "falló products" } } : { error: { message: "falló precios" } }));
    expect(await puertoKiosco(f.admin).datosProductos(SUC, ["p1"])).toEqual({ error: "falló products" });
    const g = fakeAdmin((q: Q) => (q.table === "product_prices" ? { error: { message: "falló precios" } } : { data: [] }));
    expect(await puertoKiosco(g.admin).datosProductos(SUC, ["p1"])).toEqual({ error: "falló precios" });
  });

  it("datosPromos: promos con componentes, precios por sucursal y costos de los componentes", async () => {
    const f = fakeAdmin((q: Q) => {
      if (q.table === "promos") return { data: [{ id: "pr1", price: 100, is_active: true, category_id: null, promo_items: [{ product_id: "a", cantidad: 1 }, { product_id: "b", cantidad: 2 }] }] };
      if (q.table === "promo_prices") return { data: [{ promo_id: "pr1", price: 90 }] };
      if (q.table === "product_prices") return { data: [{ product_id: "a", costo: 5 }, { product_id: "b", costo: 7 }] };
    });
    const r = await puertoKiosco(f.admin).datosPromos(SUC, ["pr1"]);
    expect(r).toMatchObject({ preciosPromo: [{ promo_id: "pr1", price: 90 }], costosComponentes: [{ product_id: "a", costo: 5 }, { product_id: "b", costo: 7 }] });
    const costos = f.calls.find((c) => c.table === "product_prices")!;
    expect(eqDe(costos, "sucursal_id")).toBe(SUC);
    expect(costos.filters).toEqual(expect.arrayContaining([{ op: "in", col: "product_id", val: ["a", "b"], extra: undefined }]));
  });
  it("datosPromos: sin componentes no consulta costos; los errores se devuelven en orden", async () => {
    const sin = fakeAdmin((q: Q) => (q.table === "promos" ? { data: [] } : undefined));
    expect(await puertoKiosco(sin.admin).datosPromos(SUC, ["pr1"])).toEqual({ promos: [], preciosPromo: [], costosComponentes: [] });
    expect(sin.calls.some((c) => c.table === "product_prices")).toBe(false);

    const e1 = fakeAdmin((q: Q) => (q.table === "promos" ? { error: { message: "falló promos" } } : undefined));
    expect(await puertoKiosco(e1.admin).datosPromos(SUC, ["pr1"])).toEqual({ error: "falló promos" });
    const e2 = fakeAdmin((q: Q) => {
      if (q.table === "promos") return { data: [{ id: "pr1", promo_items: [{ product_id: "a", cantidad: 1 }] }] };
      if (q.table === "promo_prices") return { error: { message: "falló precios de promo" } };
    });
    expect(await puertoKiosco(e2.admin).datosPromos(SUC, ["pr1"])).toEqual({ error: "falló precios de promo" });
    const e3 = fakeAdmin((q: Q) => {
      if (q.table === "promos") return { data: [{ id: "pr1", promo_items: [{ product_id: "a", cantidad: 1 }] }] };
      if (q.table === "product_prices") return { error: { message: "falló costos" } };
    });
    expect(await puertoKiosco(e3.admin).datosPromos(SUC, ["pr1"])).toEqual({ error: "falló costos" });
  });
});

describe("puerto: nombres para mostrar", () => {
  it("pide id y nombre de productos y promos, y no consulta si no hay ids", async () => {
    const f = fakeAdmin((q: Q) => (q.table === "products" ? { data: [{ id: "p1", name: "Alfajor" }] } : { data: [{ id: "pr1", name: "Combo" }] }));
    expect(await puertoKiosco(f.admin).nombres(["p1"], ["pr1"])).toEqual({ productos: [{ id: "p1", name: "Alfajor" }], promos: [{ id: "pr1", name: "Combo" }] });
    const vacio = fakeAdmin(() => ({ data: [{ id: "x", name: "x" }] }));
    expect(await puertoKiosco(vacio.admin).nombres([], [])).toEqual({ productos: [], promos: [] });
    expect(vacio.calls).toHaveLength(0);
    const soloPromos = fakeAdmin(() => ({ data: [{ id: "pr1", name: "Combo" }] }));
    await puertoKiosco(soloPromos.admin).nombres([], ["pr1"]);
    expect(soloPromos.calls.map((c) => c.table)).toEqual(["promos"]);
  });
});

describe("puerto: stock", () => {
  it("devuelve las filas de la sucursal para esos productos", async () => {
    const f = fakeAdmin(() => ({ data: [{ product_id: "p1", product_name: "Alfajor", stock_actual: 4 }] }));
    expect(await puertoKiosco(f.admin).stock(SUC, ["p1"])).toEqual([{ product_id: "p1", product_name: "Alfajor", stock_actual: 4 }]);
    expect(f.calls[0].table).toBe("stock_sucursal");
    expect(eqDe(f.calls[0], "sucursal_id")).toBe(SUC);
  });
  it("si la consulta falla devuelve null (el chequeo es de mejor esfuerzo y no bloquea el pedido)", async () => {
    const f = fakeAdmin(() => ({ error: { message: "boom" } }));
    expect(await puertoKiosco(f.admin).stock(SUC, ["p1"])).toBeNull();
  });
});

describe("puerto: registrar la venta", () => {
  const entrada = {
    sucursalId: SUC, fecha: "2026-10-01", notas: "Pedido online #abc", canal: "pedido_online",
    contactoId: "c1", pagoEfectivo: null, pagoBilletera: 1500,
    items: [{ product_id: "p1", cantidad: 2, precio_unitario: 750, subtotal: 1500, promo_id: null, extra: "se descarta" } as any],
  };

  it("llama al RPC con la misma firma de siempre (tipo venta, sin created_by) y devuelve el id", async () => {
    const f = fakeAdmin(() => undefined, () => ({ data: "mov-1" }));
    expect(await puertoKiosco(f.admin).registrarVenta(entrada)).toEqual({ movimientoId: "mov-1" });
    expect(f.rpcCalls).toHaveLength(1);
    expect(f.rpcCalls[0].name).toBe("crear_movimiento_con_items");
    expect(f.rpcCalls[0].args).toEqual({
      p_sucursal_id: SUC, p_fecha: "2026-10-01", p_tipo: "venta", p_notas: "Pedido online #abc",
      p_proveedor: null, p_proveedor_id: null, p_nro_remito: null, p_canal: "pedido_online",
      p_personal_id: null, p_contacto_id: "c1", p_pago_efectivo: null, p_pago_billetera: 1500,
      p_pago_tarjeta: null, p_pago_transferencia: null, p_created_by: null,
      p_items: [{ product_id: "p1", cantidad: 2, precio_unitario: 750, subtotal: 1500, promo_id: null }], // solo los campos del RPC
    });
  });
  it("un error del RPC se devuelve como { error } (no lanza): quien llama revierte el estado del pedido", async () => {
    const f = fakeAdmin(() => undefined, () => ({ error: { message: "sin stock" } }));
    expect(await puertoKiosco(f.admin).registrarVenta(entrada)).toEqual({ error: "sin stock" });
  });
  it("si el RPC no devuelve un id de texto, movimientoId es null", async () => {
    const f = fakeAdmin(() => undefined, () => ({ data: { raro: true } }));
    expect(await puertoKiosco(f.admin).registrarVenta(entrada)).toEqual({ movimientoId: null });
  });
});

describe("puerto: sucursales de cada persona", () => {
  const consultar = (rol: string, handler: (q: Q) => any) => puertoKiosco(fakeAdmin(handler).admin).sucursalesDelUsuario("u1", rol);

  it("admin: todas (null) sin consultar nada", async () => {
    const f = fakeAdmin(() => ({ data: [] }));
    expect(await puertoKiosco(f.admin).sucursalesDelUsuario("u1", "admin")).toBeNull();
    expect(f.calls).toHaveLength(0);
  });
  it("encargado y concesionario: las sucursales donde son encargado_user_id", async () => {
    for (const rol of ["encargado", "concesionario"]) {
      expect(await consultar(rol, () => ({ data: [{ id: "s1" }, { id: "s2" }] }))).toEqual(["s1", "s2"]);
    }
  });
  it("vendedor: profile_sucursales; si no tiene filas, la sucursal vieja de profiles", async () => {
    expect(await consultar("vendedor", (q) => (q.table === "profile_sucursales" ? { data: [{ sucursal_id: "a" }, { sucursal_id: "b" }] } : undefined))).toEqual(["a", "b"]);
    expect(await consultar("vendedor", (q) => (q.table === "profiles" ? { data: { sucursal_id: "vieja" } } : { data: [] }))).toEqual(["vieja"]);
    expect(await consultar("vendedor", () => ({ data: [] }))).toEqual([]);
  });
  it("cualquier otro rol (repartidor, desconocido): ninguna", async () => {
    for (const rol of ["repartidor", "customer_b2c", ""]) {
      expect(await consultar(rol, () => ({ data: [{ id: "s1" }] }))).toEqual([]);
    }
  });
});

// La frontera: Tenteo no lee ni escribe por su cuenta lo que es del kiosco. Si
// algún día Tenteo pasa a ser otra aplicación, solo hay que reemplazar el puerto.
describe("frontera: Tenteo no se salta el puerto", () => {
  function archivos(dir: string, acc: string[] = []): string[] {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) archivos(ruta, acc);
      else if (/\.(ts|tsx)$/.test(nombre)) acc.push(ruta);
    }
    return acc;
  }
  const raiz = join(process.cwd(), "src");
  const zonaTenteo = [
    join(raiz, "lib", "pedidos"),
    join(raiz, "lib", "tenteo"),
    join(raiz, "app", "(tenteo)"),
    join(raiz, "components", "tenteo"),
    join(raiz, "app", "pedir"),
  ];
  const permitido = join("lib", "tenteo", "puerto-kiosco-db.ts");
  // Tablas y RPC del kiosco. (sucursales NO está: la configuración de pedidos online
  // vive en columnas de esa tabla y es de Tenteo.)
  const prohibido = /\.from\(\s*["'](products|categories|product_prices|product_price_history|promos|promo_prices|promo_items|stock_sucursal|profile_sucursales|profiles|movimientos|movimiento_items|aperturas_caja|cierres_caja)["']|\.rpc\(\s*["']crear_movimiento_con_items["']/;

  it("ningún archivo de Tenteo consulta tablas del kiosco ni llama a crear_movimiento_con_items (salvo el puerto)", () => {
    const infractores: string[] = [];
    for (const zona of zonaTenteo) {
      for (const f of archivos(zona)) {
        const rel = relative(raiz, f);
        if (rel === permitido || rel.split(sep).join("/").endsWith("lib/tenteo/puerto-kiosco-db.ts")) continue;
        if (prohibido.test(readFileSync(f, "utf8"))) infractores.push(rel);
      }
    }
    expect(infractores, `acceden al kiosco sin pasar por el puerto: ${infractores.join(", ")}`).toEqual([]);
  });
});
