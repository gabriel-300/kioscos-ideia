#!/usr/bin/env node
// Genera el mapa legible de la base de datos:
//   docs/base-de-datos.md          (Markdown, con diagramas Mermaid)
//   scripts/mapa-base/mapa.html    (página para publicar como Artifact)
//
// Entradas: catalog.json (instantánea de la base viva: columnas y claves foráneas; se refresca con consultas.sql)
//           descripciones.js (lo que significa cada cosa, escrito a mano)
// Uso: node scripts/mapa-base/generar.js
// Si una descripción cita una tabla o columna que no existe en la instantánea, aborta sin escribir nada.

const fs = require("fs");
const path = require("path");
const { IDEAS, DOMINIOS, COLUMNAS_EXTRA } = require("./descripciones");
const cat = require("./catalog.json");

const RAIZ = path.resolve(__dirname, "..", "..");
const SALIDA_MD = path.join(RAIZ, "docs", "base-de-datos.md");
const SALIDA_HTML = path.join(__dirname, "mapa.html");

// ---------- catálogo ----------
const tablas = new Map();
for (const x of cat.tablas) {
  const cols = x.cols.split(" | ").map((s) => {
    const [name, type, ...flags] = s.split(":");
    return { name, type, nn: flags.includes("NN"), gen: flags.includes("GEN"), def: flags.includes("DEF") };
  });
  tablas.set(x.t, { t: x.t, vista: x.k === "v", cols });
}
const fks = cat.fks.map(([t, col, ref]) => ({ t, col, ref }));
const colDe = (t, c) => tablas.get(t).cols.find((x) => x.name === c);

// ---------- validación contra la instantánea ----------
const errores = [];
const descritas = new Set();
for (const d of DOMINIOS) {
  for (const T of d.tablas) {
    if (descritas.has(T.t)) errores.push(`descripciones: "${T.t}" aparece dos veces`);
    descritas.add(T.t);
    const tb = tablas.get(T.t);
    if (!tb) { errores.push(`descripciones: la tabla "${T.t}" no existe en la base`); continue; }
    for (const c of Object.keys(T.col)) {
      if (!colDe(T.t, c)) errores.push(`descripciones: la columna "${T.t}.${c}" no existe en la base`);
    }
  }
}
for (const [clave, txt] of Object.entries(COLUMNAS_EXTRA)) {
  const [t, c] = clave.split(".");
  const T = DOMINIOS.flatMap((d) => d.tablas).find((x) => x.t === t);
  if (!T || !colDe(t, c)) { errores.push(`COLUMNAS_EXTRA: "${clave}" no existe en la base`); continue; }
  if (T.col[c]) { errores.push(`COLUMNAS_EXTRA: "${clave}" ya estaba descripta en la tabla`); continue; }
  T.col[c] = txt;
}
for (const t of tablas.keys()) if (!descritas.has(t)) errores.push(`la tabla "${t}" existe en la base y no está descripta`);
for (const f of fks) {
  if (!colDe(f.t, f.col)) errores.push(`catalog: la FK ${f.t}.${f.col} no tiene columna`);
  if (f.ref !== "auth.users" && !tablas.has(f.ref)) errores.push(`catalog: la FK ${f.t}.${f.col} apunta a "${f.ref}", que no está`);
}
if (errores.length) {
  console.error("No se generó nada. Problemas:\n- " + errores.join("\n- "));
  process.exit(1);
}

// ---------- utilidades ----------
const TIPOS = {
  uuid: "id", text: "texto", "timestamp with time zone": "fecha y hora", date: "fecha", boolean: "sí / no",
  integer: "entero", bigint: "entero", smallint: "entero", numeric: "número", jsonb: "datos JSON",
  user_role: "tipo fijo (user_role)", "uuid[]": "lista de ids", "text[]": "lista de textos",
};
const tipoLindo = (t) => TIPOS[t.replace(/\(.*\)/, "")] || t;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const esHeredado = (txt) => typeof txt === "string" && txt.startsWith("HEREDADO");

const fkDe = (t, c) => fks.find((f) => f.t === t && f.col === c);

// Descripción de una columna: la escrita a mano, o una genérica para las columnas que se repiten en todas las tablas.
function notaDe(T, c) {
  if (T.col[c.name]) return T.col[c.name];
  const fk = fkDe(T.t, c.name);
  if (c.name === "id" && fk && fk.ref === "auth.users") return "Es el mismo identificador del usuario en auth.users.";
  if (c.name === "id") return "Identificador único de la fila.";
  if (c.name === "created_at") return "Cuándo se creó la fila.";
  if (c.name === "updated_at") return "Cuándo se modificó por última vez.";
  if (c.name === "created_by") return "Usuario que la cargó.";
  if (c.name === "updated_by") return "Usuario que la modificó por última vez.";
  if (c.name === "sucursal_id") return c.nn ? "Sucursal (local) a la que pertenece." : "Sucursal (local); puede estar vacío.";
  if (c.name === "notas") return "Observaciones libres.";
  if (fk && fk.ref !== "auth.users") return `Relación con ${fk.ref}.`;
  return "";
}

function relaciones(t) {
  const salen = fks.filter((f) => f.t === t);
  return {
    aTablas: salen.filter((f) => f.ref !== "auth.users"),
    aUsuarios: salen.filter((f) => f.ref === "auth.users" && f.col !== "id"),
    esUsuario: salen.some((f) => f.ref === "auth.users" && f.col === "id"),
    entrantes: [...new Set(fks.filter((f) => f.ref === t && f.t !== t).map((f) => f.t))].map((o) => ({
      t: o, cols: fks.filter((f) => f.ref === t && f.t === o).map((f) => f.col),
    })),
  };
}

// ---------- diagramas ----------
function erDominio(d) {
  const propias = new Set(d.tablas.filter((T) => !tablas.get(T.t).vista).map((T) => T.t));
  const aristas = [];
  const ents = new Set(propias);
  for (const f of fks) {
    // Se dibujan las referencias que SALEN de las tablas del dominio. Se omiten las que van a usuarios (auditoría)
    // y sucursal_id (casi todas las tablas la tienen y taparía el dibujo).
    if (!propias.has(f.t) || f.ref === "auth.users" || f.col === "sucursal_id" || f.t === f.ref) continue;
    ents.add(f.ref);
    const nullable = !colDe(f.t, f.col).nn;
    aristas.push(`  ${f.ref} ${nullable ? "|o" : "||"}--o{ ${f.t} : "${f.col}"`);
  }
  const cajas = [...ents].map((e) => {
    const id = colDe(e, "id");
    const tipoId = id && /int/.test(id.type) ? "int" : "uuid";
    return `  ${e} {\n    ${tipoId} id PK\n  }`;
  });
  return ["erDiagram", ...aristas, ...cajas].join("\n");
}

const FLUJO = `flowchart LR
  cat["Catálogo y precios: products, promos, product_prices"]
  mov["Movimientos: movimientos y movimiento_items"]
  stock(["Stock actual: vista stock_sucursal"])
  ped["Pedidos online: pedidos y pedido_items"]
  qr["Cobros de Mercado Pago: mercadopago_qr_orders"]
  tra["Transferencias entre locales: transferencias_stock"]
  alerta["Aviso de costo: alertas_precio"]
  caja["Turno de caja: aperturas_caja y cierres_caja"]
  ret["Retiros de efectivo: retiros_caja"]
  tes["Tesorería: pagos a proveedores, socios y cuenta corriente"]
  cat -->|"qué se vende y a cuánto"| mov
  mov -->|"se suma y se resta"| stock
  ped -->|"al cobrar se crea la venta"| mov
  qr -->|"cobro vinculado a la venta"| mov
  qr -->|"pago de un pedido online"| ped
  tra -->|"salida en el origen, entrada en el destino"| mov
  mov -->|"una entrega con otro costo"| alerta
  alerta -->|"un admin actualiza el costo"| cat
  mov -->|"las ventas del turno"| caja
  ret -->|"efectivo que sale"| caja
  tes -->|"efectivo que entra o sale"| caja`;

// ---------- Markdown ----------
const bt = (s) => "`" + s + "`";
const celda = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

function mdTabla(T) {
  const tb = tablas.get(T.t);
  const rel = relaciones(T.t);
  const L = [];
  const marca = tb.vista ? " (vista)" : esHeredado(T.que) ? " (heredada)" : "";
  L.push(`### ${bt(T.t)}${marca}`, "", `**${T.que}.** ${T.detalle}`, "");
  L.push("| Columna | Tipo | Qué guarda |", "| --- | --- | --- |");
  const sinNota = [];
  for (const c of tb.cols) {
    const n = notaDe(T, c);
    const propia = !!T.col[c.name];
    if (!propia) { sinNota.push(c.name); continue; }
    const banderas = [c.gen ? "calculada" : "", c.nn && !c.def && !c.gen ? "obligatoria" : ""].filter(Boolean);
    const tipo = tipoLindo(c.type) + (banderas.length ? ` · ${banderas.join(", ")}` : "");
    const fk = fkDe(T.t, c.name);
    L.push(`| ${bt(c.name)} | ${celda(tipo + (fk && fk.ref !== "auth.users" ? ` → ${fk.ref}` : ""))} | ${celda(n)} |`);
  }
  if (tb.cols.length === sinNota.length) L.pop(), L.pop(), L.pop();
  if (sinNota.length) L.push("", `Otras columnas: ${sinNota.map(bt).join(", ")}.`);
  const partes = [];
  if (rel.aTablas.length) partes.push(`**Apunta a:** ${rel.aTablas.map((f) => `${bt(f.col)} → ${bt(f.ref)}`).join(" · ")}`);
  if (rel.esUsuario) partes.push(`**Su ${bt("id")} es el usuario de** ${bt("auth.users")}`);
  if (rel.aUsuarios.length) partes.push(`**Personas (auth.users):** ${rel.aUsuarios.map((f) => bt(f.col)).join(", ")}`);
  if (rel.entrantes.length) partes.push(`**La usan:** ${rel.entrantes.map((e) => `${bt(e.t)} (${e.cols.join(", ")})`).join(" · ")}`);
  if (partes.length) L.push("", partes.join("  \n"));
  L.push("");
  return L.join("\n");
}

function armarMd() {
  const L = [];
  L.push("# Base de datos de Kioscos IDEIA: mapa legible", "");
  L.push(`> Generado por ${bt("scripts/mapa-base/generar.js")} a partir de una instantánea de la base viva (${bt("catalog.json")}, ${cat.generado}) y de las descripciones escritas a mano (${bt("descripciones.js")}). **No se edita a mano**: se corrigen esos dos archivos y se vuelve a generar. Si este documento contradice a la base, gana la base. Cómo actualizarlo, al final.`, "");
  L.push(`Son **${tablas.size} tablas y vistas**, **${fks.length} relaciones** (claves foráneas) y ${DOMINIOS.length} dominios. Este documento explica qué significa cada cosa; para el detalle de cómo se usa desde la aplicación, ver [architecture.md](architecture.md) y [requirements.md](requirements.md).`, "");
  L.push("## Ideas clave para leer la base", "");
  for (const [t, x] of IDEAS) L.push(`- **${t}.** ${x}`);
  L.push("", "## Cómo circula la mercadería y la plata", "", "```mermaid", FLUJO, "```", "");
  L.push("Es un dibujo simplificado: cada flecha resume varias reglas que están en el código y en las funciones de la base (ver architecture.md).", "");
  for (const d of DOMINIOS) {
    L.push(`## ${d.nombre}`, "", d.resumen, "");
    L.push("```mermaid", erDominio(d), "```", "");
    L.push("Cada línea es una relación: la tabla del lado de la izquierda es la \"madre\" (uno) y la de la derecha la que la referencia (muchos); el nombre es la columna que las une. Un círculo en la madre significa que la columna puede estar vacía. No se dibujan las columnas que apuntan a usuarios (quién cargó o modificó algo) ni `sucursal_id` (casi todas las tablas la tienen).", "");
    for (const T of d.tablas) L.push(mdTabla(T));
  }
  L.push("## Cómo actualizar este documento", "");
  L.push("1. Ejecutar `scripts/mapa-base/consultas.sql` en el SQL Editor de Supabase (o con el MCP de solo lectura) y guardar el resultado en `scripts/mapa-base/catalog.json`.");
  L.push("2. Si hay tablas o columnas nuevas, describirlas en `scripts/mapa-base/descripciones.js`. El generador avisa de lo que falta o de lo que ya no existe.");
  L.push("3. `node scripts/mapa-base/generar.js`, y commitear `docs/base-de-datos.md` en el mismo commit que la migración.", "");
  return L.join("\n");
}

// ---------- HTML ----------
function htmlColumnas(T) {
  const tb = tablas.get(T.t);
  const filas = tb.cols.map((c) => {
    const n = notaDe(T, c);
    const her = esHeredado(T.col[c.name]);
    const fk = fkDe(T.t, c.name);
    const ins = [
      her ? '<span class="ins her">heredada</span>' : "",
      c.gen ? '<span class="ins calc">calculada</span>' : "",
      c.nn && !c.def && !c.gen && c.name !== "id" ? '<span class="ins req">obligatoria</span>' : "",
    ].join("");
    const destino = fk && fk.ref !== "auth.users" ? ` <a class="rel" href="#t-${fk.ref}">→ ${esc(fk.ref)}</a>` : fk ? ' <span class="mut">→ usuario</span>' : "";
    return `<tr class="${her ? "her-fila" : ""}"><td><code>${esc(c.name)}</code></td><td class="tipo" title="${esc(c.type)}">${esc(tipoLindo(c.type))}${destino}</td><td>${ins}${esc(n) || '<span class="mut">—</span>'}</td></tr>`;
  });
  return `<div class="tabla-scroll"><table class="cols"><thead><tr><th>Columna</th><th>Tipo</th><th>Qué guarda</th></tr></thead><tbody>${filas.join("")}</tbody></table></div>`;
}

function htmlRelaciones(t) {
  const rel = relaciones(t);
  const enlace = (x) => `<a class="rel" href="#t-${x}">${esc(x)}</a>`;
  const bloques = [];
  const sale = [
    ...rel.aTablas.map((f) => `<li><code>${esc(f.col)}</code> → ${enlace(f.ref)}</li>`),
    rel.esUsuario ? `<li><code>id</code> es el usuario de <span class="mut">auth.users</span></li>` : "",
    rel.aUsuarios.length ? `<li class="mut">Personas (auth.users): ${rel.aUsuarios.map((f) => `<code>${esc(f.col)}</code>`).join(", ")}</li>` : "",
  ].filter(Boolean);
  if (sale.length) bloques.push(`<div><h4>Apunta a</h4><ul>${sale.join("")}</ul></div>`);
  if (rel.entrantes.length) {
    const denso = rel.entrantes.length > 8;
    bloques.push(`<div${denso ? ' class="ancho"' : ""}><h4>La usan (${rel.entrantes.length})</h4><ul${denso ? ' class="denso"' : ""}>${rel.entrantes.map((e) => `<li>${enlace(e.t)} <span class="mut">(${e.cols.map(esc).join(", ")})</span></li>`).join("")}</ul></div>`);
  }
  return bloques.length ? `<div class="rels">${bloques.join("")}</div>` : "";
}

function htmlTabla(T) {
  const tb = tablas.get(T.t);
  const busq = norm([T.t, T.que, T.detalle, ...tb.cols.map((c) => c.name), ...Object.values(T.col)].join(" "));
  const marcas = [
    tb.vista ? '<span class="ins vista">vista</span>' : "",
    esHeredado(T.que) ? '<span class="ins her">heredada</span>' : "",
  ].join("");
  return `<details class="tabla" id="t-${esc(T.t)}" data-q="${esc(busq)}">
<summary><span class="tn">${esc(T.t)}</span><span class="tq">${marcas}${esc(T.que)}</span><span class="tc">${tb.cols.length} columnas</span></summary>
<div class="cuerpo"><p class="detalle">${esc(T.detalle)}</p>${htmlColumnas(T)}${htmlRelaciones(T.t)}</div>
</details>`;
}

function armarHtml() {
  const nav = [`<a href="#ideas">Ideas clave</a>`, `<a href="#flujo">Flujos</a>`, ...DOMINIOS.map((d) => `<a href="#dom-${d.id}">${esc(d.nombre)}</a>`)].join("");
  const ideas = IDEAS.map(([t, x]) => `<div class="idea"><h3>${esc(t)}</h3><p>${esc(x)}</p></div>`).join("");
  const dominios = DOMINIOS.map((d) => `<section class="dominio" id="dom-${d.id}">
<h2>${esc(d.nombre)} <span class="cuenta">${d.tablas.length} ${d.tablas.length === 1 ? "tabla" : "tablas"}</span></h2>
<p class="resumen">${esc(d.resumen)}</p>
<div class="diagrama"><pre class="mermaid">${esc(erDominio(d))}</pre></div>
<p class="leyenda">Cada línea une una tabla \"madre\" (izquierda, uno) con la que la referencia (derecha, muchos); el nombre es la columna que las une. No se dibujan las columnas de auditoría (quién cargó algo) ni <code>sucursal_id</code>, que casi todas tienen.</p>
<div class="lista">${d.tablas.map(htmlTabla).join("\n")}</div>
</section>`).join("\n");

  return `<title>Mapa de la base</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{
  --bg:#F4F6F3; --surface:#FFFFFF; --ink:#18231F; --muted:#586761; --line:#D9DFD9; --code-bg:#EBEFEA;
  --accent:#17665A; --accent-soft:#DDEEE8;
  --her-bg:#FBEACB; --her-ink:#7A4A00; --calc-bg:#E1EAF7; --calc-ink:#1F4A80; --req-bg:#ECEFEA; --req-ink:#46544E; --vista-bg:#E9E3F6; --vista-ink:#4B3A85;
  --sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif; --mono:"IBM Plex Mono",ui-monospace,"Cascadia Code",Consolas,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#0F1512; --surface:#171F1B; --ink:#E3EBE6; --muted:#9BAAA3; --line:#2A3630; --code-bg:#1F2924;
  --accent:#5EC4A8; --accent-soft:#1A2F28;
  --her-bg:#3B2D10; --her-ink:#F0C978; --calc-bg:#1B2B44; --calc-ink:#9EC2F2; --req-bg:#222D27; --req-ink:#A9B8B1; --vista-bg:#2A2347; --vista-ink:#C5B8F2;
}}
:root[data-theme="dark"]{
  --bg:#0F1512; --surface:#171F1B; --ink:#E3EBE6; --muted:#9BAAA3; --line:#2A3630; --code-bg:#1F2924;
  --accent:#5EC4A8; --accent-soft:#1A2F28;
  --her-bg:#3B2D10; --her-ink:#F0C978; --calc-bg:#1B2B44; --calc-ink:#9EC2F2; --req-bg:#222D27; --req-ink:#A9B8B1; --vista-bg:#2A2347; --vista-ink:#C5B8F2;
}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:15px/1.55 var(--sans);-webkit-text-size-adjust:100%}
a{color:var(--accent)}
code{font-family:var(--mono);font-size:.88em;background:var(--code-bg);padding:.08em .35em;border-radius:4px}
h1,h2,h3,h4{text-wrap:balance;margin:0}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.top{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--surface);border-bottom:1px solid var(--line);padding:.7rem 16px .6rem}
.top-in{max-width:1000px;margin:0 auto;display:grid;gap:.55rem}
.marca{display:flex;flex-wrap:wrap;align-items:baseline;gap:.15rem .9rem}
.marca h1{font-size:1.15rem;font-weight:600;letter-spacing:-.01em}
.meta{margin:0;color:var(--muted);font-size:.82rem}
#q{width:100%;font:inherit;padding:.5rem .75rem;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink)}
#q::placeholder{color:var(--muted)}
.nav{display:flex;gap:.35rem;overflow-x:auto;white-space:nowrap;padding-bottom:.15rem;scrollbar-width:thin}
.nav a{font-size:.82rem;text-decoration:none;color:var(--ink);padding:.2rem .6rem;border:1px solid var(--line);border-radius:999px}
.nav a:hover{background:var(--accent-soft);border-color:var(--accent)}

main{max-width:1000px;margin:0 auto;padding:1.4rem 16px 4rem;display:grid;gap:2.6rem}
section{scroll-margin-top:9.5rem}
h2{font-size:1.4rem;font-weight:600;letter-spacing:-.015em;display:flex;flex-wrap:wrap;align-items:baseline;gap:.2rem .8rem}
.cuenta{font-size:.78rem;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.resumen{margin:.4rem 0 1rem;max-width:65ch;color:var(--muted)}
.ideas-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:1.2rem 2rem;margin-top:1rem}
.idea{border-top:2px solid var(--accent);padding-top:.6rem}
.idea h3{font-size:.98rem;font-weight:600}
.idea p{margin:.3rem 0 0;font-size:.9rem;color:var(--muted)}
.diagrama{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:1rem;overflow-x:auto}
.diagrama pre{margin:0;text-align:center}
.leyenda{margin:.5rem 0 1.1rem;font-size:.82rem;color:var(--muted);max-width:75ch}
.lista{border:1px solid var(--line);border-radius:8px;background:var(--surface);overflow:hidden}
details.tabla+details.tabla{border-top:1px solid var(--line)}
summary{display:grid;grid-template-columns:minmax(0,17rem) minmax(0,1fr) auto;gap:.15rem 1rem;align-items:baseline;padding:.7rem 1rem;cursor:pointer;list-style:none}
summary::-webkit-details-marker{display:none}
summary:hover{background:var(--accent-soft)}
.tn{font-family:var(--mono);font-weight:500;font-size:.9rem;overflow-wrap:anywhere}
.tn::before{content:"";display:inline-block;width:.42em;height:.42em;border-right:2px solid var(--accent);border-bottom:2px solid var(--accent);transform:rotate(-45deg);margin-right:.65em;position:relative;top:-.08em;transition:transform .15s}
details[open]>summary .tn::before{transform:rotate(45deg)}
.tq{color:var(--muted);font-size:.9rem}
.tc{color:var(--muted);font-size:.78rem;font-variant-numeric:tabular-nums;white-space:nowrap}
.cuerpo{padding:.2rem 1rem 1.1rem 2.2rem;display:grid;gap:.9rem}
.detalle{margin:0;max-width:70ch}
.tabla-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:6px}
table.cols{border-collapse:collapse;width:100%;font-size:.85rem}
.cols th{text-align:left;font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);background:var(--bg);padding:.4rem .7rem;white-space:nowrap}
.cols td{padding:.4rem .7rem;border-top:1px solid var(--line);vertical-align:top}
.cols td:first-child{white-space:nowrap}
.cols td.tipo{white-space:nowrap;color:var(--muted)}
.cols td:last-child{min-width:16rem}
.her-fila{background:color-mix(in srgb,var(--her-bg) 35%,transparent)}
.ins{display:inline-block;font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding:.05rem .4rem;border-radius:4px;margin-right:.45rem;vertical-align:.08em}
.ins.her{background:var(--her-bg);color:var(--her-ink)}
.ins.calc{background:var(--calc-bg);color:var(--calc-ink)}
.ins.req{background:var(--req-bg);color:var(--req-ink)}
.ins.vista{background:var(--vista-bg);color:var(--vista-ink)}
.mut{color:var(--muted)}
.rels{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:.9rem 2rem}
.rels h4{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:.3rem}
.rels ul{margin:0;padding:0;list-style:none;display:grid;gap:.2rem;font-size:.87rem}
.rels .ancho{grid-column:1/-1}
.rels ul.denso{display:flex;flex-wrap:wrap;gap:.2rem 1.1rem}
a.rel{font-family:var(--mono);font-size:.85em;text-decoration:none}
a.rel:hover{text-decoration:underline}
#vacio{color:var(--muted)}
.pie{color:var(--muted);font-size:.82rem;max-width:70ch}
@media (max-width:640px){
  summary{grid-template-columns:minmax(0,1fr) auto}
  .tq{grid-column:1/-1;grid-row:2}
  .cuerpo{padding-left:1rem}
}
@media (prefers-reduced-motion:reduce){.tn::before{transition:none}}
</style>

<header class="top"><div class="top-in">
  <div class="marca"><h1>Mapa de la base</h1><p class="meta">Kioscos IDEIA · instantánea del ${esc(cat.generado)} · ${tablas.size} tablas y vistas · ${fks.length} relaciones</p></div>
  <input id="q" type="search" placeholder="Buscar una tabla, una columna o una palabra (fiado, costo, termo, remito…)" aria-label="Buscar en el mapa" autocomplete="off">
  <nav class="nav" aria-label="Secciones">${nav}</nav>
</div></header>

<main>
<section class="intro" id="ideas">
  <h2>Ideas clave para leer la base</h2>
  <div class="ideas-grid">${ideas}</div>
</section>

<section class="intro" id="flujo">
  <h2>Cómo circula la mercadería y la plata</h2>
  <p class="resumen">Un dibujo simplificado: cada flecha resume varias reglas que viven en el código y en las funciones de la base.</p>
  <div class="diagrama"><pre class="mermaid">${esc(FLUJO)}</pre></div>
</section>

${dominios}

<p id="vacio" hidden>Ninguna tabla coincide con la búsqueda.</p>
<p class="pie">Se genera con <code>scripts/mapa-base/generar.js</code> a partir de la base viva y de descripciones escritas a mano. Si algo acá contradice a la base, gana la base. Las columnas marcadas <span class="ins her">heredada</span> vienen de otro proyecto que comparte la base: no se usan.</p>
</main>

<script>
(function () {
  var q = document.getElementById("q");
  var cards = [].slice.call(document.querySelectorAll("details.tabla"));
  var secs = [].slice.call(document.querySelectorAll("section.dominio"));
  var intro = [].slice.call(document.querySelectorAll("section.intro"));
  var vacio = document.getElementById("vacio");
  function norm(s) { return s.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, ""); }
  function filtrar() {
    var v = norm(q.value.trim()), n = 0;
    cards.forEach(function (c) { var ok = !v || c.getAttribute("data-q").indexOf(v) >= 0; c.hidden = !ok; if (ok) n++; });
    cards.forEach(function (c) { c.open = !!v && !c.hidden && n <= 6; });
    secs.forEach(function (s) { s.hidden = !!v && !s.querySelector("details.tabla:not([hidden])"); });
    intro.forEach(function (s) { s.hidden = !!v; });
    vacio.hidden = !v || n > 0;
  }
  q.addEventListener("input", filtrar);
  function abrir() {
    var id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    var el = document.getElementById(id);
    if (!el || el.tagName !== "DETAILS") return;
    if (q.value) { q.value = ""; filtrar(); }
    el.open = true;
    el.scrollIntoView();
  }
  window.addEventListener("hashchange", abrir);
  abrir();
})();
</script>
`;
}

fs.writeFileSync(SALIDA_MD, armarMd(), "utf8");
fs.writeFileSync(SALIDA_HTML, armarHtml(), "utf8");
console.log(`Listo: ${tablas.size} tablas, ${fks.length} relaciones.\n  ${path.relative(RAIZ, SALIDA_MD)}\n  ${path.relative(RAIZ, SALIDA_HTML)}`);
