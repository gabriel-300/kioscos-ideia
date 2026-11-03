import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

// Catálogo con dueño (migración 131): un concesionario cuya sucursal tiene catalogo_propio carga SUS
// productos/categorías/promos y nada más; el admin carga el catálogo global. Las guardas son lo único que
// separa a un local de otro (el cliente admin no aplica RLS), así que se prueban a fondo.

const MIA = "suc-dueno";
const OTRA = "suc-otra";

const h = vi.hoisted(() => ({ session: { userId: "u1", role: "concesionario" }, admin: null as any }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({
  requireStaff: async () => h.session,
  requireAdmin: async () => {
    if (h.session.role !== "admin") throw new Error("Sin permisos de administrador");
    return h.session;
  },
}));
vi.mock("@/lib/auth/sucursal-access", () => ({ requireSucursalAccess: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin, createClient: async () => ({}) }));

import { alcanceCatalogo, puedeEditarFila, requireCatalogo, requireDueno, validarFilaEditable } from "@/lib/auth/catalogo-propio";
import { filtroCatalogoDe } from "@/lib/catalogo-dueno";
import { crearProducto, actualizarProducto, toggleProductoActivo } from "@/app/(admin)/admin/productos/actions";
import { crearCategoria, actualizarCategoria } from "@/app/(admin)/admin/categorias/actions";
import { crearPromo } from "@/app/(admin)/admin/promociones/actions";
import { crearVendedor, suspenderVendedor } from "@/app/(admin)/admin/mi-personal/actions";
import { actualizarPrecioProducto } from "@/app/(admin)/admin/sucursales/[id]/precios/actions";
import { enviarTransferencia } from "@/app/(admin)/admin/sucursales/[id]/transferencia-actions";
import { crearAuditoria } from "@/app/(admin)/admin/sucursales/[id]/auditoria-actions";

interface Mundo {
  /** sucursal con catalogo_propio del usuario (null = no tiene) */
  catalogoPropio?: string | null;
  /** "tabla:id" → dueño de esa fila (null = global). Lo que no esté acá, no existe. */
  owners?: Record<string, string | null>;
}

function armar(m: Mundo = {}) {
  const owners = m.owners ?? {};
  const f = fakeAdmin((q: Q) => {
    if (q.table === "sucursales" && q.op === "select") {
      if (q.filters.some((x) => x.col === "catalogo_propio")) return { data: m.catalogoPropio ? { id: m.catalogoPropio } : null };
      return { data: [{ id: MIA, is_active: true, catalogo_propio: m.catalogoPropio === MIA }, { id: OTRA, is_active: true, catalogo_propio: false }] };
    }
    if (["products", "categories", "promos"].includes(q.table) && q.op === "select") {
      const id = q.filters.find((x) => x.op === "eq" && x.col === "id")?.val as string | undefined;
      const idsIn = q.filters.find((x) => x.op === "in" && x.col === "id")?.val as string[] | undefined;
      if (id) {
        const k = `${q.table}:${id}`;
        return { data: k in owners ? { owner_sucursal_id: owners[k] } : null };
      }
      if (idsIn) {
        return { data: idsIn.filter((i) => `${q.table}:${i}` in owners).map((i) => ({ id: i, owner_sucursal_id: owners[`${q.table}:${i}`] })) };
      }
      return { data: [] }; // like("slug", …)
    }
    if (q.table === "auditorias_stock" && q.op === "insert") return { data: { id: "aud1" } };
    if (q.table === "aperturas_caja") return { data: { id: "ap1", created_at: "2026-01-02T00:00:00Z" } };
    if (q.op === "insert" && ["products", "categories", "promos"].includes(q.table)) return { data: { id: "nuevo" } };
    return { data: [] };
  });
  h.admin = f.admin;
  return f;
}

beforeEach(() => { h.session = { userId: "u1", role: "concesionario" }; h.admin = null; });

describe("alcanceCatalogo", () => {
  it("admin: sin límite", async () => {
    armar();
    expect(await alcanceCatalogo("a", "admin")).toEqual({ userId: "a", role: "admin", ownerSucursalId: null });
  });
  it("concesionario con catálogo propio: limitado a su sucursal", async () => {
    armar({ catalogoPropio: MIA });
    expect(await alcanceCatalogo("u1", "concesionario")).toEqual({ userId: "u1", role: "concesionario", ownerSucursalId: MIA });
  });
  it("concesionario SIN catálogo propio (Villa Sarita): nada", async () => {
    armar({ catalogoPropio: null });
    expect(await alcanceCatalogo("u1", "concesionario")).toBeNull();
  });
  it("encargado, vendedor y repartidor: nada, aunque tengan sucursal", async () => {
    armar({ catalogoPropio: MIA });
    for (const r of ["encargado", "vendedor", "repartidor", "customer_b2c"]) expect(await alcanceCatalogo("u1", r)).toBeNull();
  });
  it("requireCatalogo lanza sin permisos; requireDueno solo deja al concesionario con catálogo propio", async () => {
    h.session = { userId: "u1", role: "vendedor" };
    armar({ catalogoPropio: MIA });
    await expect(requireCatalogo()).rejects.toThrow(/permisos/);
    await expect(requireDueno()).rejects.toThrow(/permisos/);
    h.session = { userId: "u1", role: "admin" };
    await expect(requireDueno()).rejects.toThrow(/permisos/); // el admin usa Staff, no esta pantalla
    h.session = { userId: "u1", role: "concesionario" };
    await expect(requireDueno()).resolves.toEqual({ userId: "u1", sucursalId: MIA });
  });
});

describe("puedeEditarFila / validarFilaEditable", () => {
  it("el admin edita cualquiera; el dueño solo lo suyo (no lo global ni lo de otro)", () => {
    const admin = { userId: "a", role: "admin", ownerSucursalId: null };
    const dueno = { userId: "u", role: "concesionario", ownerSucursalId: MIA };
    expect(puedeEditarFila(admin, null)).toBe(true);
    expect(puedeEditarFila(admin, OTRA)).toBe(true);
    expect(puedeEditarFila(dueno, MIA)).toBe(true);
    expect(puedeEditarFila(dueno, null)).toBe(false);
    expect(puedeEditarFila(dueno, OTRA)).toBe(false);
  });
  it("validarFilaEditable lee el dueño real de la base", async () => {
    armar({ owners: { "products:g": null, "products:p": MIA, "products:o": OTRA } });
    const dueno = { userId: "u", role: "concesionario", ownerSucursalId: MIA };
    expect(await validarFilaEditable(dueno, "products", "p")).toBeNull();
    expect(await validarFilaEditable(dueno, "products", "g")).toMatch(/No podés/);
    expect(await validarFilaEditable(dueno, "products", "o")).toMatch(/No podés/);
    expect(await validarFilaEditable(dueno, "products", "no-existe")).toBe("No existe");
  });
});

describe("filtroCatalogoDe", () => {
  it("global o de esa sucursal", () => {
    expect(filtroCatalogoDe("abc")).toBe("owner_sucursal_id.is.null,owner_sucursal_id.eq.abc");
  });
});

describe("crearProducto", () => {
  const base = { name: "Alfajor", sku: "ALF-1", slug: "", is_active: true } as any;
  const precioMio = { sucursal_id: MIA, precio_dist: 1000, costo: 600 };

  it("el dueño crea con owner = su sucursal, aunque el cliente mande otro dueño, y precio solo en su sucursal", async () => {
    const { calls } = armar({ catalogoPropio: MIA });
    const r = await crearProducto({ ...base, owner_sucursal_id: OTRA, precios: [precioMio] });
    expect(r.error).toBeUndefined();
    const ins = calls.find((c) => c.table === "products" && c.op === "insert")!;
    expect(ins.payload.owner_sucursal_id).toBe(MIA);
    const pr = calls.find((c) => c.table === "product_prices" && c.op === "insert")!;
    expect(pr.payload.map((p: any) => p.sucursal_id)).toEqual([MIA]);
  });
  it("rechaza precios en otra sucursal o en varias (así nadie más puede venderlo)", async () => {
    armar({ catalogoPropio: MIA });
    const a = await crearProducto({ ...base, precios: [{ ...precioMio, sucursal_id: OTRA }] });
    expect(a.error).toMatch(/solo en la sucursal/);
    const b = await crearProducto({ ...base, precios: [precioMio, { ...precioMio, sucursal_id: OTRA }] });
    expect(b.error).toMatch(/solo en la sucursal/);
  });
  it("rechaza una categoría de otro local", async () => {
    const { calls } = armar({ catalogoPropio: MIA, owners: { "categories:c-otra": OTRA } });
    const r = await crearProducto({ ...base, category_id: "c-otra", precios: [precioMio] });
    expect(r.error).toMatch(/otro local/);
    expect(calls.some((c) => c.table === "products" && c.op === "insert")).toBe(false);
  });
  it("acepta una categoría global o propia", async () => {
    armar({ catalogoPropio: MIA, owners: { "categories:c-glob": null, "categories:c-mia": MIA } });
    for (const cat of ["c-glob", "c-mia"]) {
      const r = await crearProducto({ ...base, category_id: cat, precios: [precioMio] });
      expect(r.error, cat).toBeUndefined();
    }
  });
  it("sin catálogo propio no crea nada", async () => {
    armar({ catalogoPropio: null });
    await expect(crearProducto({ ...base, precios: [precioMio] })).rejects.toThrow(/permisos/);
  });
  it("el admin crea global (owner null) y exige precio en todas las sucursales activas", async () => {
    h.session = { userId: "adm", role: "admin" };
    const { calls } = armar();
    const falta = await crearProducto({ ...base, precios: [precioMio] });
    expect(falta.error).toMatch(/Falta el precio/);
    const ok = await crearProducto({ ...base, precios: [precioMio, { ...precioMio, sucursal_id: OTRA }] });
    expect(ok.error).toBeUndefined();
    expect(calls.find((c) => c.table === "products" && c.op === "insert")!.payload.owner_sucursal_id).toBeNull();
  });
});

describe("actualizar / desactivar producto", () => {
  it("el dueño no puede modificar un producto global ni el de otro local", async () => {
    armar({ catalogoPropio: MIA, owners: { "products:g": null, "products:o": OTRA } });
    for (const id of ["g", "o"]) {
      const r = await actualizarProducto(id, { name: "x", precios: [{ sucursal_id: MIA, precio_dist: 1, costo: 1 }] });
      expect(r.error, id).toMatch(/No podés/);
      await expect(toggleProductoActivo(id, true)).rejects.toThrow(/No podés/);
    }
  });
  it("sí modifica el suyo, sin poder cambiarle el dueño", async () => {
    const { calls } = armar({ catalogoPropio: MIA, owners: { "products:p": MIA } });
    const r = await actualizarProducto("p", { name: "nuevo", owner_sucursal_id: OTRA, precios: [{ sucursal_id: MIA, precio_dist: 5, costo: 3 }] });
    expect(r.error).toBeUndefined();
    const upd = calls.find((c) => c.table === "products" && c.op === "update")!;
    expect(upd.payload).not.toHaveProperty("owner_sucursal_id");
  });
});

describe("categorías", () => {
  it("la categoría del dueño lleva su owner y un slug con sufijo (el slug es único en toda la base)", async () => {
    const { calls } = armar({ catalogoPropio: MIA });
    await crearCategoria({ name: "Bebidas" });
    const ins = calls.find((c) => c.table === "categories" && c.op === "insert")!;
    expect(ins.payload.owner_sucursal_id).toBe(MIA);
    expect(ins.payload.slug).toBe(`bebidas-${MIA.slice(0, 6)}`);
  });
  it("el dueño no edita una categoría global", async () => {
    armar({ catalogoPropio: MIA, owners: { "categories:g": null } });
    await expect(actualizarCategoria("g", { name: "x" })).rejects.toThrow(/No podés/);
  });
  it("el admin crea global con slug simple", async () => {
    h.session = { userId: "adm", role: "admin" };
    const { calls } = armar();
    await crearCategoria({ name: "Bebidas" });
    const ins = calls.find((c) => c.table === "categories" && c.op === "insert")!;
    expect(ins.payload.owner_sucursal_id).toBeNull();
    expect(ins.payload.slug).toBe("bebidas");
  });
});

describe("promociones", () => {
  const promo = (over: any = {}) => ({
    name: "Combo", is_active: true, tipo: "promo", cover_image_url: null, category_id: null, requiere_termo: false,
    items: [{ product_id: "p-mio", cantidad: 1 }], precios: [{ sucursal_id: MIA, price: 100 }], ...over,
  });
  it("el dueño arma combos con productos propios o globales, con owner = su sucursal", async () => {
    const { calls } = armar({ catalogoPropio: MIA, owners: { "products:p-mio": MIA, "products:p-glob": null } });
    await crearPromo(promo({ items: [{ product_id: "p-mio", cantidad: 1 }, { product_id: "p-glob", cantidad: 2 }] }));
    expect(calls.find((c) => c.table === "promos" && c.op === "insert")!.payload.owner_sucursal_id).toBe(MIA);
  });
  it("rechaza un combo con un producto de otro local", async () => {
    const { calls } = armar({ catalogoPropio: MIA, owners: { "products:p-mio": MIA, "products:p-otro": OTRA } });
    await expect(crearPromo(promo({ items: [{ product_id: "p-mio", cantidad: 1 }, { product_id: "p-otro", cantidad: 1 }] }))).rejects.toThrow(/otro local/);
    expect(calls.some((c) => c.table === "promos" && c.op === "insert")).toBe(false);
  });
  it("rechaza precio en otra sucursal", async () => {
    armar({ catalogoPropio: MIA, owners: { "products:p-mio": MIA } });
    await expect(crearPromo(promo({ precios: [{ sucursal_id: OTRA, price: 100 }] }))).rejects.toThrow(/solo en la sucursal/);
  });
});

describe("mi personal (crearVendedor / suspenderVendedor)", () => {
  it("sin catálogo propio no se puede", async () => {
    armar({ catalogoPropio: null });
    await expect(crearVendedor({ email: "a@b.com", nombre: "A", password: "12345678" })).rejects.toThrow(/permisos/);
  });
  it("valida nombre, email y contraseña", async () => {
    armar({ catalogoPropio: MIA });
    expect((await crearVendedor({ email: "a@b.com", nombre: " ", password: "12345678" })).error).toMatch(/nombre/);
    expect((await crearVendedor({ email: "mal", nombre: "A", password: "12345678" })).error).toMatch(/email/);
    expect((await crearVendedor({ email: "a@b.com", nombre: "A", password: "123" })).error).toMatch(/8 caracteres/);
  });
  it("crea un vendedor del kiosco (rol y sistema los fija el servidor) y lo asigna solo a su sucursal", async () => {
    const f = armar({ catalogoPropio: MIA });
    const createUser = vi.fn(async (_: unknown) => ({ data: { user: { id: "v1" } }, error: null }));
    f.admin.auth = { admin: { createUser } };
    const r = await crearVendedor({ email: "A@B.com", nombre: "Ana", password: "12345678" });
    expect(r.error).toBeUndefined();
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "a@b.com", app_metadata: { role: "vendedor", sistemas: ["kiosco"] },
    }));
    const ps = f.calls.find((c) => c.table === "profile_sucursales" && c.op === "upsert")!;
    expect(ps.payload).toEqual({ profile_id: "v1", sucursal_id: MIA });
  });
  it("no suspende a alguien que no es vendedor propio (otro rol, o habilitado en otro kiosco)", async () => {
    let usuario: any;
    let filas: any[] = [];
    const updateUserById = vi.fn(async (..._a: unknown[]) => ({ error: null }));
    const f = armar({ catalogoPropio: MIA });
    const base = f.admin;
    h.admin = {
      ...base,
      auth: { admin: { getUserById: async () => ({ data: { user: usuario }, error: null }), updateUserById } },
      from: (tabla: string) => tabla === "profile_sucursales"
        ? { select: () => ({ eq: async () => ({ data: filas }) }) }
        : base.from(tabla),
    };

    usuario = { app_metadata: { role: "encargado" } }; filas = [{ sucursal_id: MIA }];
    expect((await suspenderVendedor("x", true)).error).toMatch(/vendedores/);
    usuario = { app_metadata: { role: "vendedor" } }; filas = [{ sucursal_id: MIA }, { sucursal_id: OTRA }];
    expect((await suspenderVendedor("x", true)).error).toMatch(/no es de tu local/);
    filas = [];
    expect((await suspenderVendedor("x", true)).error).toMatch(/no es de tu local/);
    expect(updateUserById).not.toHaveBeenCalled();
    filas = [{ sucursal_id: MIA }];
    expect((await suspenderVendedor("x", true)).error).toBeUndefined();
    expect(updateUserById).toHaveBeenCalledWith("x", { ban_duration: "876600h" });
  });
});

describe("precios por sucursal: no se le pone precio a un producto propio de otro local", () => {
  const dato = (product_id: string, sucursal_id = MIA) => ({ product_id, sucursal_id, precio_dist: 100, costo: 60 });

  it("rechaza un producto propio de otro local (si no, quedaría vendible acá)", async () => {
    const { calls } = armar({ catalogoPropio: MIA, owners: { "products:ajeno": OTRA } });
    const r = await actualizarPrecioProducto(dato("ajeno"));
    expect(r.error).toMatch(/no está disponible/);
    expect(calls.some((c) => c.table === "product_prices" && c.op === "upsert")).toBe(false);
  });
  it("rechaza un producto que no existe", async () => {
    armar({ catalogoPropio: MIA, owners: {} });
    expect((await actualizarPrecioProducto(dato("fantasma"))).error).toMatch(/no existe/);
  });
  it("acepta uno global y uno propio de esta misma sucursal", async () => {
    const { calls } = armar({ catalogoPropio: MIA, owners: { "products:glob": null, "products:mio": MIA } });
    for (const id of ["glob", "mio"]) expect((await actualizarPrecioProducto(dato(id))).error, id).toBeUndefined();
    expect(calls.filter((c) => c.table === "product_prices" && c.op === "upsert")).toHaveLength(2);
  });
  it("un concesionario SIN catálogo propio (Villa Sarita) tampoco puede ponerle precio a lo de otro local", async () => {
    armar({ catalogoPropio: null, owners: { "products:ajeno": OTRA } });
    expect((await actualizarPrecioProducto(dato("ajeno", "villa-sarita"))).error).toMatch(/no está disponible/);
  });
});

describe("transferencias de stock: un producto propio no viaja a otro local", () => {
  const envio = (ids: string[]) => ({
    sucursal_origen_id: MIA, sucursal_destino_id: OTRA, fecha: "2026-11-03", notas: null,
    items: ids.map((product_id) => ({ product_id, cantidad: 1 })),
  });

  it("rechaza un producto propio del origen (el destino no lo puede tener)", async () => {
    const f = armar({ catalogoPropio: MIA, owners: { "products:mio": MIA } });
    const r = await enviarTransferencia(envio(["mio"]));
    expect(r.error).toMatch(/no está disponible/);
    expect(f.rpcCalls).toHaveLength(0);
  });
  it("rechaza un producto propio del destino (no se lo puede mandar un local ajeno)", async () => {
    const f = armar({ catalogoPropio: MIA, owners: { "products:delotro": OTRA } });
    const r = await enviarTransferencia(envio(["delotro"]));
    expect(r.error).toMatch(/no está disponible/);
    expect(f.rpcCalls).toHaveLength(0);
  });
  it("deja transferir productos globales", async () => {
    const f = armar({ catalogoPropio: MIA, owners: { "products:glob": null } });
    const r = await enviarTransferencia(envio(["glob"]));
    expect(r.error).toBeUndefined();
    expect(f.rpcCalls.map((c) => c.name)).toEqual(["enviar_transferencia_stock"]);
  });
});

describe("auditoría de stock: solo con productos que existen en esa sucursal", () => {
  const item = (product_id: string) => ({ product_id, stock_sistema: 5, stock_contado: 5, observacion: null });

  it("rechaza un producto propio de otro local", async () => {
    const { calls } = armar({ catalogoPropio: MIA, owners: { "products:ajeno": OTRA } });
    const r = await crearAuditoria(MIA, [item("ajeno")]);
    expect(r.error).toMatch(/no está disponible/);
    expect(calls.some((c) => c.table === "auditorias_stock" && c.op === "insert")).toBe(false);
  });
  it("acepta globales y propios de esa sucursal", async () => {
    armar({ catalogoPropio: MIA, owners: { "products:glob": null, "products:mio": MIA } });
    expect((await crearAuditoria(MIA, [item("glob"), item("mio")])).error).toBeUndefined();
  });
});

describe("catálogo global del admin: no se le imponen precios a un local independiente", () => {
  const precioIdeia = { sucursal_id: OTRA, precio_dist: 1000, costo: 600 };
  it("crear un producto global exige precio solo en los kioscos de IDEIA, no en el local con catálogo propio", async () => {
    h.session = { userId: "adm", role: "admin" };
    const { calls } = armar({ catalogoPropio: MIA });
    const r = await crearProducto({ name: "Alfajor", sku: "ALF-9", slug: "", is_active: true, precios: [precioIdeia] } as any);
    expect(r.error).toBeUndefined();
    const pr = calls.find((c) => c.table === "product_prices" && c.op === "insert")!;
    expect(pr.payload.map((p: any) => p.sucursal_id)).toEqual([OTRA]);
  });
  it("sigue exigiendo precio en los kioscos de IDEIA", async () => {
    h.session = { userId: "adm", role: "admin" };
    armar({ catalogoPropio: MIA });
    const r = await crearProducto({ name: "Alfajor", sku: "ALF-9", slug: "", is_active: true, precios: [] } as any);
    expect(r.error).toMatch(/Falta el precio/);
  });
  it("lo mismo para las promos globales", async () => {
    h.session = { userId: "adm", role: "admin" };
    armar({ catalogoPropio: MIA, owners: { "products:glob": null } });
    await expect(crearPromo({
      name: "Combo", is_active: true, tipo: "promo", cover_image_url: null, category_id: null, requiere_termo: false,
      items: [{ product_id: "glob", cantidad: 1 }], precios: [{ sucursal_id: OTRA, price: 100 }],
    })).resolves.toBeUndefined();
  });
});
