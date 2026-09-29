import { slugComandera, type CatalogoComandera } from "./catalogo";

// Genera el archivo HTML autocontenido de la comandera offline: un solo archivo,
// sin dependencias externas (ni fuentes, ni scripts, ni imágenes), que se abre con
// doble click en Chrome/Edge sin internet. El catálogo viaja adentro como JSON.
//
// Las ventas se guardan en localStorage del navegador (clave por sucursal) y el
// número de ticket sigue de donde quedó aunque se cierre el navegador. Imprime con
// window.print() -- el ticket es un <div> que solo se ve al imprimir (@media print),
// en formato de 80 mm.
//
// OJO al editar PLANTILLA: es un String.raw, así que no puede llevar backticks ni
// la secuencia dollar-llave. El JS de adentro se escribe con comillas y concatenación.

const PLANTILLA = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comandera</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#f3f5f1;color:#1d2a20;font-size:16px}
button{font:inherit;cursor:pointer}
.top{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#2f6b3f;color:#fff}
.top h1{font-size:18px;margin:0;flex:1;line-height:1.2}
.top small{display:block;font-weight:400;font-size:12px;opacity:.85}
.top .next{font-size:14px;opacity:.95;white-space:nowrap}
.btn{border:0;border-radius:10px;padding:10px 14px;font-weight:600;background:#e4ebe2;color:#1d2a20}
.btn.pri{background:#2f6b3f;color:#fff}
.btn.big{padding:16px;font-size:20px;width:100%}
.btn.warn{background:#f3d9d6;color:#8a2016}
.top .btn{background:rgba(255,255,255,.18);color:#fff}
.aviso{background:#fff3cd;color:#664d03;padding:8px 14px;font-size:14px;display:none}
.wrap{display:grid;grid-template-columns:1fr 360px;height:calc(100% - 52px)}
.izq{display:flex;flex-direction:column;min-height:0;padding:10px 12px 0}
.tools{display:flex;gap:8px;margin-bottom:8px}
.tools input{flex:1;font:inherit;padding:10px 12px;border:1px solid #c7d1c4;border-radius:10px;background:#fff}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.chip{border:1px solid #c7d1c4;background:#fff;border-radius:999px;padding:6px 12px;font-size:14px}
.chip.on{background:#2f6b3f;color:#fff;border-color:#2f6b3f}
.grid{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;align-content:start;padding-bottom:12px}
.prod{position:relative;text-align:left;background:#fff;border:1px solid #d5ddd2;border-radius:12px;padding:10px;min-height:88px;display:flex;flex-direction:column;justify-content:space-between}
.prod:active{background:#e7f1e5}
.prod .n{font-weight:600;line-height:1.2}
.prod .p{color:#2f6b3f;font-weight:700;margin-top:6px}
.prod .q{position:absolute;top:-6px;right:-6px;background:#c0392b;color:#fff;border-radius:999px;min-width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;padding:0 6px}
.vacio{color:#5b6b5f;padding:20px;text-align:center}
.der{background:#fff;border-left:1px solid #d5ddd2;display:flex;flex-direction:column;min-height:0}
.der h2{margin:0;padding:12px 14px;font-size:16px;border-bottom:1px solid #e4ebe2}
.items{flex:1;overflow:auto;padding:6px 14px}
.it{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:8px 0;border-bottom:1px dashed #d5ddd2}
.it .nm{font-weight:600}
.it .sb{text-align:right;font-weight:600}
.qty{display:flex;align-items:center;gap:6px;grid-column:1 / 3}
.qty button{width:36px;height:36px;border:1px solid #c7d1c4;background:#f3f5f1;border-radius:8px;font-size:20px;line-height:1}
.qty span{min-width:28px;text-align:center;font-weight:700}
.qty .rm{margin-left:auto;width:auto;padding:0 10px;font-size:13px;color:#8a2016}
.pie{padding:12px 14px;border-top:1px solid #e4ebe2}
.tot{display:flex;justify-content:space-between;font-size:24px;font-weight:800;margin-bottom:10px}
.pie .fila{display:flex;gap:8px;margin-top:8px}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:14px;z-index:10}
.modal.on{display:flex}
.caja{background:#fff;border-radius:14px;padding:18px;width:100%;max-width:440px;max-height:92vh;overflow:auto}
.caja.ancha{max-width:760px}
.caja h3{margin:0 0 10px;font-size:20px}
.caja label{display:block;font-size:14px;margin:12px 0 4px;color:#4a5a4e}
.caja input{width:100%;font:inherit;font-size:22px;padding:10px 12px;border:1px solid #c7d1c4;border-radius:10px}
.vuelto{font-size:22px;font-weight:800;margin-top:12px;min-height:30px}
.err{color:#b3261e;font-weight:600;min-height:22px;margin-top:6px}
.acc{display:flex;gap:8px;margin-top:14px}
.acc .btn{flex:1}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:6px 8px;border-bottom:1px solid #e4ebe2;text-align:left;vertical-align:top}
td.r,th.r{text-align:right}
tr.anul td{color:#8b8b8b;text-decoration:line-through}
.res{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 12px}
.res div{background:#f3f5f1;border-radius:10px;padding:8px 12px}
.res b{display:block;font-size:20px}
.tabs{display:flex;gap:6px;margin-bottom:10px}
#ticket{display:none}
@media (max-width:820px){
  .wrap{grid-template-columns:1fr;grid-template-rows:1fr auto;height:calc(100% - 52px)}
  .der{border-left:0;border-top:1px solid #d5ddd2;max-height:46vh}
}
@media print{
  @page{size:80mm auto;margin:0}
  html,body{height:auto;background:#fff}
  body>*:not(#ticket){display:none!important}
  #ticket{display:block;width:72mm;margin:0 auto;padding:4mm 0 12mm;font-family:"Courier New",monospace;color:#000}
  #ticket .c{text-align:center}
  #ticket .suc{font-size:16px;font-weight:700;text-transform:uppercase}
  #ticket .sub{font-size:12px}
  #ticket .num{font-size:46px;font-weight:800;line-height:1.1;margin:2px 0}
  #ticket hr{border:0;border-top:2px dashed #000;margin:8px 0}
  #ticket .li{display:flex;gap:8px;font-size:17px;font-weight:700;margin:3px 0}
  #ticket .li .x{min-width:34px}
  #ticket .li .d{flex:1}
  #ticket .tt{display:flex;justify-content:space-between;font-size:18px;font-weight:800}
  #ticket .fila{display:flex;justify-content:space-between;font-size:14px}
  #ticket .ret{font-size:14px;font-weight:700;text-align:center;margin-top:6px}
  #ticket .leg{font-size:10px;text-align:center;margin-top:8px}
}
</style>
</head>
<body>
<div class="top">
  <h1 id="titulo">Comandera<small id="sub"></small></h1>
  <span class="next" id="next"></span>
  <button class="btn" id="btnResumen">Ventas / Resumen</button>
</div>
<div class="aviso" id="aviso"></div>
<div class="wrap">
  <div class="izq">
    <div class="tools"><input id="buscar" type="search" placeholder="Buscar producto..." autocomplete="off"></div>
    <div class="chips" id="chips"></div>
    <div class="grid" id="grid"></div>
  </div>
  <div class="der">
    <h2>Pedido</h2>
    <div class="items" id="items"></div>
    <div class="pie">
      <div class="tot"><span>TOTAL</span><span id="total">$ 0</span></div>
      <button class="btn pri big" id="btnCobrar">Cobrar e imprimir</button>
      <div class="fila"><button class="btn" id="btnVaciar" style="flex:1">Vaciar pedido</button></div>
    </div>
  </div>
</div>

<div class="modal" id="mCobro"><div class="caja">
  <h3>Cobrar</h3>
  <div class="tt" style="display:flex;justify-content:space-between;font-size:26px;font-weight:800"><span>Total</span><span id="cTotal"></span></div>
  <label for="cRecibido">Recibido en efectivo (opcional, para calcular el vuelto)</label>
  <input id="cRecibido" type="number" inputmode="decimal" min="0" step="any">
  <div class="vuelto" id="cVuelto"></div>
  <div class="err" id="cErr"></div>
  <div class="acc"><button class="btn" id="cCancelar">Cancelar</button><button class="btn pri" id="cOk">Cobrar e imprimir</button></div>
</div></div>

<div class="modal" id="mRes"><div class="caja ancha">
  <h3>Ventas y resumen</h3>
  <div class="tabs"><button class="btn pri" id="tabVentas">Tickets</button><button class="btn" id="tabProd">Por producto</button></div>
  <div class="res" id="resNums"></div>
  <div id="resCuerpo"></div>
  <div class="acc" style="flex-wrap:wrap">
    <button class="btn pri" id="btnCsv">Exportar ventas (CSV)</button>
    <button class="btn warn" id="btnBorrar">Borrar todo (nuevo evento)</button>
    <button class="btn" id="btnCerrarRes">Cerrar</button>
  </div>
</div></div>

<div id="ticket"></div>

<script>
(function(){
"use strict";
var DATA = __DATA__;
var KEY = "comandera:" + DATA.clave;
var storageOk = true;
var money = new Intl.NumberFormat("es-AR", {style:"currency", currency:"ARS", minimumFractionDigits:0, maximumFractionDigits:2});

function $(id){ return document.getElementById(id); }
function h(tag, attrs, kids){
  var e = document.createElement(tag), k;
  if (attrs) for (k in attrs) {
    if (k === "class") e.className = attrs[k];
    else if (k === "text") e.textContent = attrs[k];
    else if (k.slice(0,2) === "on") e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  (kids || []).forEach(function(c){ if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
  return e;
}
function norm(s){ return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function pad(n){ n = String(n); while (n.length < 4) n = "0" + n; return n; }
function p2(n){ return n < 10 ? "0" + n : String(n); }
function fecha(t){ var d = new Date(t); return p2(d.getDate()) + "/" + p2(d.getMonth()+1) + "/" + d.getFullYear(); }
function hora(t){ var d = new Date(t); return p2(d.getHours()) + ":" + p2(d.getMinutes()); }
function redondear(n){ return Math.round(n * 100) / 100; }

/* ---- estado persistente ---- */
var state = { next: 1, ventas: [] };
try {
  var raw = localStorage.getItem(KEY);
  if (raw) {
    var st = JSON.parse(raw);
    if (st && Array.isArray(st.ventas) && typeof st.next === "number") state = st;
  }
} catch (e) { storageOk = false; }
function guardar(){
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { storageOk = false; avisar(); }
}
function avisar(){
  var a = $("aviso");
  if (!storageOk) {
    a.style.display = "block";
    a.textContent = "Este navegador no permite guardar las ventas: si lo cerrás se pierden. Exportá el CSV seguido (Ventas / Resumen).";
  }
}

/* ---- catálogo ---- */
var items = {};
DATA.categorias.forEach(function(c){ c.items.forEach(function(i){ items[i.id] = i; }); });
var catActiva = "todos";
var carrito = []; // {id, nombre, precio, qty}

function cant(id){ for (var i=0;i<carrito.length;i++) if (carrito[i].id === id) return carrito[i].qty; return 0; }
function agregar(id, d){
  var it = items[id], i;
  for (i=0;i<carrito.length;i++) if (carrito[i].id === id) break;
  if (i === carrito.length) { if (d < 0) return; carrito.push({id:id, nombre:it.nombre, precio:it.precio, qty:0}); }
  carrito[i].qty += d;
  if (carrito[i].qty <= 0) carrito.splice(i, 1);
  pintar();
}
function totalCarrito(){ var t = 0; carrito.forEach(function(l){ t += l.precio * l.qty; }); return redondear(t); }

function pintarChips(){
  var c = $("chips"); c.textContent = "";
  var lista = [{id:"todos", nombre:"Todos"}].concat(DATA.categorias);
  if (lista.length <= 2) return; // una sola categoría: no hace falta filtrar
  lista.forEach(function(k){
    c.appendChild(h("button", {class:"chip" + (k.id === catActiva ? " on" : ""), text:k.nombre, onclick:function(){ catActiva = k.id; pintar(); }}));
  });
}
function pintarGrid(){
  var g = $("grid"); g.textContent = "";
  var q = norm($("buscar").value.trim()), n = 0;
  DATA.categorias.forEach(function(c){
    if (catActiva !== "todos" && catActiva !== c.id) return;
    c.items.forEach(function(it){
      if (q && norm(it.nombre).indexOf(q) < 0) return;
      n++;
      var qn = cant(it.id);
      g.appendChild(h("button", {class:"prod", onclick:function(){ agregar(it.id, 1); }}, [
        h("span", {class:"n", text:it.nombre}),
        h("span", {class:"p", text:money.format(it.precio)}),
        qn ? h("span", {class:"q", text:String(qn)}) : null
      ]));
    });
  });
  if (!n) g.appendChild(h("div", {class:"vacio", text:"No hay productos para mostrar."}));
}
function pintarCarrito(){
  var box = $("items"); box.textContent = "";
  if (!carrito.length) box.appendChild(h("div", {class:"vacio", text:"Tocá un producto para agregarlo."}));
  carrito.forEach(function(l){
    box.appendChild(h("div", {class:"it"}, [
      h("span", {class:"nm", text:l.nombre}),
      h("span", {class:"sb", text:money.format(redondear(l.precio * l.qty))}),
      h("div", {class:"qty"}, [
        h("button", {text:"−", onclick:function(){ agregar(l.id, -1); }}),
        h("span", {text:String(l.qty)}),
        h("button", {text:"+", onclick:function(){ agregar(l.id, 1); }}),
        h("button", {class:"rm", text:"Quitar", onclick:function(){ agregar(l.id, -l.qty); }})
      ])
    ]));
  });
  $("total").textContent = money.format(totalCarrito());
  $("btnCobrar").disabled = !carrito.length;
  $("btnCobrar").style.opacity = carrito.length ? "1" : ".5";
}
function pintar(){
  pintarChips(); pintarGrid(); pintarCarrito();
  $("next").textContent = "Próximo ticket: Nº " + pad(state.next);
}

/* ---- cobro ---- */
function abrirCobro(){
  if (!carrito.length) return;
  $("cTotal").textContent = money.format(totalCarrito());
  $("cRecibido").value = ""; $("cVuelto").textContent = ""; $("cErr").textContent = "";
  $("mCobro").classList.add("on");
  setTimeout(function(){ $("cRecibido").focus(); }, 50);
}
function vueltoActual(){
  var v = $("cRecibido").value;
  if (v === "") return null;
  return redondear(Number(v) - totalCarrito());
}
function confirmarCobro(){
  var v = vueltoActual(), recibido = null;
  if (v !== null) {
    if (isNaN(v) || v < 0) { $("cErr").textContent = "El monto recibido es menor al total."; return; }
    recibido = Number($("cRecibido").value);
  }
  var venta = {
    n: state.next, t: Date.now(), total: totalCarrito(), recibido: recibido, anulada: false,
    items: carrito.map(function(l){ return {id:l.id, nombre:l.nombre, precio:l.precio, qty:l.qty}; })
  };
  state.next += 1;
  state.ventas.push(venta);
  guardar();            // primero se guarda: si la impresora falla, la venta no se pierde
  carrito = [];
  $("mCobro").classList.remove("on");
  pintar();
  imprimir(venta);
}

/* ---- ticket ---- */
function imprimir(v){
  var t = $("ticket"); t.textContent = "";
  var c = function(cls, txt){ return h("div", {class:cls, text:txt}); };
  t.appendChild(h("div", {class:"c"}, [
    c("suc", DATA.titulo),
    c("sub", "TICKET DE RETIRO"),
    h("hr"),
    c("num", "Nº " + pad(v.n)),
    c("sub", fecha(v.t) + "  " + hora(v.t)),
    h("hr")
  ]));
  v.items.forEach(function(l){
    t.appendChild(h("div", {class:"li"}, [h("span", {class:"x", text:l.qty + " x"}), h("span", {class:"d", text:l.nombre})]));
  });
  t.appendChild(h("hr"));
  t.appendChild(h("div", {class:"tt"}, [h("span", {text:"TOTAL"}), h("span", {text:money.format(v.total)})]));
  if (v.recibido != null) {
    t.appendChild(h("div", {class:"fila"}, [h("span", {text:"Recibido"}), h("span", {text:money.format(v.recibido)})]));
    t.appendChild(h("div", {class:"fila"}, [h("span", {text:"Vuelto"}), h("span", {text:money.format(redondear(v.recibido - v.total))})]));
  }
  t.appendChild(h("hr"));
  t.appendChild(c("ret", "PRESENTE ESTE TICKET PARA RETIRAR SU PEDIDO"));
  t.appendChild(c("leg", "Comprobante no valido como factura"));
  window.print();
}

/* ---- resumen ---- */
var tabRes = "ventas";
function vigentes(){ return state.ventas.filter(function(v){ return !v.anulada; }); }
function pintarResumen(){
  var vig = vigentes(), total = 0, unid = 0;
  vig.forEach(function(v){ total += v.total; v.items.forEach(function(l){ unid += l.qty; }); });
  var nums = $("resNums"); nums.textContent = "";
  [["Tickets", String(vig.length)], ["Unidades", String(unid)], ["Total cobrado", money.format(redondear(total))]].forEach(function(p){
    nums.appendChild(h("div", {}, [h("b", {text:p[1]}), p[0]]));
  });
  $("tabVentas").className = "btn" + (tabRes === "ventas" ? " pri" : "");
  $("tabProd").className = "btn" + (tabRes === "prod" ? " pri" : "");
  var cuerpo = $("resCuerpo"); cuerpo.textContent = "";
  if (!state.ventas.length) { cuerpo.appendChild(h("div", {class:"vacio", text:"Todavía no hay ventas."})); return; }
  var tb = h("table"), i;
  if (tabRes === "ventas") {
    tb.appendChild(h("tr", {}, [h("th", {text:"Ticket"}), h("th", {text:"Hora"}), h("th", {text:"Detalle"}), h("th", {class:"r", text:"Total"}), h("th")]));
    for (i = state.ventas.length - 1; i >= 0; i--) (function(v){
      var det = v.items.map(function(l){ return l.qty + " x " + l.nombre; }).join(", ");
      var acc = h("td", {class:"r"});
      if (!v.anulada) {
        acc.appendChild(h("button", {class:"btn", text:"Reimprimir", onclick:function(){ imprimir(v); }}));
        acc.appendChild(document.createTextNode(" "));
        acc.appendChild(h("button", {class:"btn warn", text:"Anular", onclick:function(){
          if (confirm("Anular el ticket Nº " + pad(v.n) + "? No se puede deshacer.")) { v.anulada = true; guardar(); pintarResumen(); }
        }}));
      } else acc.textContent = "ANULADO";
      tb.appendChild(h("tr", {class:v.anulada ? "anul" : ""}, [
        h("td", {text:pad(v.n)}), h("td", {text:hora(v.t)}), h("td", {text:det}), h("td", {class:"r", text:money.format(v.total)}), acc
      ]));
    })(state.ventas[i]);
  } else {
    var por = {}, orden = [];
    vigentes().forEach(function(v){ v.items.forEach(function(l){
      if (!por[l.id]) { por[l.id] = {nombre:l.nombre, qty:0, monto:0}; orden.push(l.id); }
      por[l.id].qty += l.qty; por[l.id].monto += l.precio * l.qty;
    }); });
    orden.sort(function(a,b){ return por[b].qty - por[a].qty; });
    tb.appendChild(h("tr", {}, [h("th", {text:"Producto"}), h("th", {class:"r", text:"Unidades"}), h("th", {class:"r", text:"Monto"})]));
    orden.forEach(function(id){
      tb.appendChild(h("tr", {}, [h("td", {text:por[id].nombre}), h("td", {class:"r", text:String(por[id].qty)}), h("td", {class:"r", text:money.format(redondear(por[id].monto))})]));
    });
  }
  cuerpo.appendChild(tb);
}
function csv(){
  function q(s){ return '"' + String(s).replace(/"/g, '""') + '"'; }
  var filas = [["ticket","fecha","hora","producto","cantidad","precio_unitario","subtotal","estado"].join(";")];
  state.ventas.forEach(function(v){
    v.items.forEach(function(l){
      filas.push([pad(v.n), fecha(v.t), hora(v.t), q(l.nombre), l.qty, String(l.precio).replace(".", ","), String(redondear(l.precio * l.qty)).replace(".", ","), v.anulada ? "ANULADO" : "OK"].join(";"));
    });
  });
  var blob = new Blob([String.fromCharCode(0xFEFF) + filas.join("\r\n")], {type:"text/csv;charset=utf-8"});
  var a = document.createElement("a");
  var d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = "ventas-" + DATA.titulo.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + "-" + d.getFullYear() + p2(d.getMonth()+1) + p2(d.getDate()) + "-" + p2(d.getHours()) + p2(d.getMinutes()) + ".csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/* ---- eventos ---- */
$("buscar").addEventListener("input", pintarGrid);
$("btnCobrar").addEventListener("click", abrirCobro);
$("btnVaciar").addEventListener("click", function(){ if (carrito.length && confirm("Vaciar el pedido?")) { carrito = []; pintar(); } });
$("cCancelar").addEventListener("click", function(){ $("mCobro").classList.remove("on"); });
$("cOk").addEventListener("click", confirmarCobro);
$("cRecibido").addEventListener("input", function(){
  var v = vueltoActual();
  $("cErr").textContent = "";
  $("cVuelto").textContent = v === null || isNaN(v) ? "" : (v < 0 ? "Falta " + money.format(-v) : "Vuelto: " + money.format(v));
});
$("cRecibido").addEventListener("keydown", function(e){ if (e.key === "Enter") confirmarCobro(); });
$("btnResumen").addEventListener("click", function(){ tabRes = "ventas"; pintarResumen(); $("mRes").classList.add("on"); });
$("btnCerrarRes").addEventListener("click", function(){ $("mRes").classList.remove("on"); });
$("tabVentas").addEventListener("click", function(){ tabRes = "ventas"; pintarResumen(); });
$("tabProd").addEventListener("click", function(){ tabRes = "prod"; pintarResumen(); });
$("btnCsv").addEventListener("click", csv);
$("btnBorrar").addEventListener("click", function(){
  if (!state.ventas.length && state.next === 1) return;
  var r = prompt("Esto borra TODAS las ventas y reinicia el numero de ticket en 1.\nExporta el CSV antes.\nPara confirmar escribi BORRAR:");
  if (r !== null && r.trim().toUpperCase() === "BORRAR") { state = {next:1, ventas:[]}; guardar(); pintar(); pintarResumen(); }
});
document.addEventListener("keydown", function(e){
  if (e.key === "Escape") { $("mCobro").classList.remove("on"); $("mRes").classList.remove("on"); }
});

document.title = "Comandera - " + DATA.titulo;
$("titulo").firstChild.nodeValue = DATA.titulo;
$("sub").textContent = "Precios al " + fecha(Date.parse(DATA.generado)) + " " + hora(Date.parse(DATA.generado)) + " - sin conexion";
avisar();
pintar();
})();
</script>
</body>
</html>
`;

// JSON seguro para incrustar dentro de <script>: sin "<" (evita cerrar el script o abrir
// un comentario HTML) y sin los separadores de línea U+2028/2029, que en JS antiguo cortan strings.
function jsonParaScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .split(String.fromCharCode(0x2028)).join("\\u2028")
    .split(String.fromCharCode(0x2029)).join("\\u2029");
}

export function generarComanderaHtml(catalogo: CatalogoComandera): string {
  const { omitidosPorKg: _omitidos, sucursalNombre: _sucursal, ...datos } = catalogo; // el aviso de kg es para quien descarga, no para el archivo
  return PLANTILLA.replace("__DATA__", () => jsonParaScript(datos));
}

export function nombreArchivoComandera(catalogo: CatalogoComandera): string {
  return `comandera-${slugComandera(catalogo.titulo) || "sucursal"}.html`;
}
