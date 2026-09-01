import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Ayuda — Kioscos IDEIA" };
export const revalidate = 0;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-xl border border-neutral-200 bg-white p-5 md:p-6 space-y-4">
      <h2 className="text-lg font-semibold font-display text-neutral-900">{title}</h2>
      {children}
    </section>
  );
}

function Paso({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="shrink-0 size-6 rounded-full bg-tierra-50 border border-tierra-200 text-tierra-700 text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div className="text-sm text-neutral-700 leading-relaxed">{children}</div>
    </div>
  );
}

function Boton({ children }: { children: React.ReactNode }) {
  return <span className="inline-block rounded-md bg-neutral-100 border border-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-700">{children}</span>;
}

function Campo({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-neutral-900">{children}</span>;
}

function Nota({ tipo = "info", children }: { tipo?: "info" | "warn" | "ok"; children: React.ReactNode }) {
  const styles = {
    info: "border-blue-200 bg-blue-50 text-blue-800",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
    ok:   "border-selva-200 bg-selva-50 text-selva-800",
  }[tipo];
  return <div className={`rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${styles}`}>{children}</div>;
}

export default async function AyudaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role as string) ?? "";
  const esVendedor  = role === "vendedor";
  const esEncargado = role === "encargado";
  const esAdmin     = role === "admin";

  const toc = [
    { id: "abrir-caja",  label: "Abrir la caja" },
    { id: "traspaso",    label: "Traspaso de turno" },
    { id: "vender",      label: "Registrar una venta" },
    { id: "anular",      label: "Anular una venta" },
    { id: "recepcion",   label: "Recepción de mercadería" },
    { id: "retiro",      label: "Retiro de efectivo" },
    { id: "merma",       label: "Registrar una merma" },
    { id: "cerrar-caja", label: "Cerrar la caja" },
    { id: "sobre",       label: "El sobre de efectivo" },
    ...(esEncargado || esAdmin ? [
      { id: "pagos-proveedores", label: "Pagos a proveedores" },
      { id: "socios",            label: "Socios (retiros y devoluciones)" },
    ] : []),
    { id: "stock",       label: "Consultar el stock" },
    ...(esEncargado || esAdmin ? [{ id: "pronostico", label: "Pronóstico" }] : []),
    ...(esAdmin ? [{ id: "sueldos", label: "Sueldos por empleado" }] : []),
    { id: "faq",         label: "Preguntas frecuentes" },
  ];

  return (
    <div className="p-4 md:p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Ayuda</h1>
        <p className="text-sm text-neutral-400 mt-0.5">
          Procedimiento de caja y guía de los módulos que tenés habilitados
          {esVendedor && " como vendedor"}
          {esEncargado && " como encargado"}
          {esAdmin && " — referencia general para todo el equipo"}
          .
        </p>
      </div>

      <nav className="flex flex-wrap gap-2">
        {toc.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className="text-xs font-medium rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-neutral-600 hover:border-tierra-300 hover:text-tierra-700 transition-colors"
          >
            {t.label}
          </a>
        ))}
      </nav>

      {(esVendedor || esEncargado) && (
        <Nota tipo="info">
          Todo esto se hace desde <Campo>Mi Kiosco</Campo>, el primer módulo del menú. Además tenés acceso a{" "}
          <Campo>Stock</Campo> {esEncargado && (<>y <Campo>Pronóstico</Campo> </>)}para consulta. El resto de los
          módulos (Productos, Precios, Categorías, Finanzas, Reportes, etc.) son exclusivos de administración.
        </Nota>
      )}

      <Section id="abrir-caja" title="1. Abrir la caja">
        <p className="text-sm text-neutral-600">
          Es lo primero que hay que hacer al empezar el turno. Sin la caja abierta, el sistema no deja registrar ventas.
        </p>
        <div className="space-y-3">
          <Paso n={1}>Entrá a <Campo>Mi Kiosco</Campo>.</Paso>
          <Paso n={2}>Tocá el botón <Boton>Abrir caja</Boton>, arriba a la derecha.</Paso>
          <Paso n={3}>
            Cargá el <Campo>Fondo inicial (efectivo)</Campo>: la plata en efectivo que hay físicamente en el cajón
            para arrancar (para dar vuelto, por ejemplo).
          </Paso>
          <Paso n={4}>Confirmá. El botón va a pasar a decir <Boton>Caja abierta ✓</Boton>.</Paso>
        </div>
        <Nota tipo="warn">
          Si intentás vender sin abrir la caja, el sistema muestra "No hay caja abierta. Registrá una apertura antes
          de vender" y no deja continuar.
        </Nota>
      </Section>

      <Section id="traspaso" title="2. Traspaso de turno (cambio de persona)">
        <p className="text-sm text-neutral-600">
          Desde ahora hay <Campo>una sola caja por día</Campo>. Cuando cambia quién está atendiendo el kiosco, ya no
          se cierra la caja — se hace un traspaso.
        </p>
        <div className="space-y-3">
          <Paso n={1}>La persona que llega toca <Boton>Traspaso de turno</Boton>, al lado de "Cerrar caja".</Paso>
          <Paso n={2}>Cuenta toda la plata en efectivo que hay en el cajón en ese momento.</Paso>
          <Paso n={3}>Carga ese número en <Campo>Contás en el cajón</Campo>.</Paso>
          <Paso n={4}>
            El sistema muestra si coincide con lo que esperaba. Si hay diferencia, pide explicar qué pasó antes de
            dejar continuar — igual que al cerrar caja.
          </Paso>
          <Paso n={5}>
            Confirma con <Boton>Confirmar recepción</Boton>. A partir de ahí, esa persona es quien puede cerrar la
            caja y ve todo el movimiento del día, no solo el suyo.
          </Paso>
        </div>
        <Nota tipo="warn">
          La caja <Campo>NO se cierra</Campo> con el traspaso — sigue siendo el mismo turno de todo el día. Cerrar
          caja (ver más abajo) es solo al terminar el día, no en cada cambio de persona.
        </Nota>
      </Section>

      <Section id="vender" title="3. Registrar una venta">
        <div className="space-y-3">
          <Paso n={1}>Tocá <Boton>Registrar venta</Boton>.</Paso>
          <Paso n={2}>
            Elegí el canal arriba a la derecha del ticket:
            <ul className="list-disc pl-5 mt-1.5 space-y-1">
              <li><Campo>Consumidor Final</Campo>: una venta normal de mostrador.</li>
              <li><Campo>Pedido Ya</Campo>: el precio se puede editar a mano si viene de la app.</li>
              <li><Campo>Cta. Corriente</Campo>: para vender fiado a una persona ya registrada (elegís quién es). No pide medio de pago porque no se cobra en el momento.</li>
              <li><Campo>Ambulante</Campo>: venta de kiosco ambulante.</li>
            </ul>
          </Paso>
          <Paso n={3}>Tocá los productos para agregarlos al ticket. Podés tocar de nuevo para sumar cantidad.</Paso>
          <Paso n={4}>
            Al cobrar, elegí el o los medios de pago: <Campo>Efectivo</Campo> (te calcula el vuelto solo),{" "}
            <Campo>Billetera virtual</Campo>, <Campo>Tarjeta</Campo> o <Campo>Transferencia</Campo>. Se puede combinar
            más de uno en la misma venta (por ejemplo, parte efectivo y parte tarjeta).
          </Paso>
          <Paso n={5}>Confirmá el cobro. El ticket queda guardado y el stock se descuenta solo.</Paso>
        </div>
      </Section>

      <Section id="anular" title="4. Anular una venta">
        <p className="text-sm text-neutral-600">
          Para cuando cargaste una venta por error — por ejemplo, la cargaste dos veces sin darte cuenta, o le
          pusiste otro producto.
        </p>
        <div className="space-y-3">
          <Paso n={1}>
            Bajá hasta <Campo>Historial de movimientos</Campo>, en la misma pantalla de Mi Kiosco, y buscá la venta
            (la más reciente aparece primero).
          </Paso>
          <Paso n={2}>Tocá el ícono de <Campo>✕</Campo> al lado del de imprimir ticket.</Paso>
          <Paso n={3}>Escribí por qué la anulás (es obligatorio) y confirmá.</Paso>
        </div>
        <Nota tipo="warn">
          Solo se puede anular mientras la caja de ese turno siga abierta. Una vez que esa caja se cerró, la venta
          queda fija para siempre — si te das cuenta después, avisale al admin.
        </Nota>
        <Nota tipo="info">
          La venta anulada no desaparece: queda en el Historial marcada como <Campo>"Anulada"</Campo> con el motivo,
          pero no cuenta para el stock ni para el cierre de caja — es como si no hubiera pasado.
        </Nota>
      </Section>

      <Section id="recepcion" title="5. Recepción de mercadería">
        <p className="text-sm text-neutral-600">Para cargar lo que llega de un proveedor y que sume al stock.</p>
        <div className="space-y-3">
          <Paso n={1}>Tocá <Boton>Registrar recepción</Boton>.</Paso>
          <Paso n={2}>Elegí el proveedor, los productos y las cantidades que llegaron.</Paso>
          <Paso n={3}>Guardá. El stock se actualiza al instante.</Paso>
        </div>
        <Nota tipo="ok">
          No hace falta esperar a nada: podés cargar una recepción aunque todavía no hayas abierto la caja del día,
          se va a ver bien igual.
        </Nota>
      </Section>

      <Section id="retiro" title="6. Retiro de efectivo">
        <p className="text-sm text-neutral-600">
          Para cuando sacás plata del cajón durante el turno (pagar un flete, dar cambio a otra caja, etc.).
        </p>
        <div className="space-y-3">
          <Paso n={1}>Tocá <Boton>Retiro</Boton>.</Paso>
          <Paso n={2}>Cargá el <Campo>monto</Campo> y el <Campo>motivo</Campo>. Opcionalmente podés sacarle una foto al comprobante.</Paso>
          <Paso n={3}>Guardá. Ese monto se descuenta automáticamente de lo que el sistema espera encontrar en el cajón al cerrar.</Paso>
        </div>
      </Section>

      <Section id="merma" title="7. Registrar una merma">
        <p className="text-sm text-neutral-600">
          Para productos rotos, vencidos o perdidos — así el stock queda correcto sin que figure como una venta.
        </p>
        <div className="space-y-3">
          <Paso n={1}>Tocá <Boton>Merma</Boton>.</Paso>
          <Paso n={2}>Elegí el producto y la cantidad que se perdió.</Paso>
          <Paso n={3}>Guardá.</Paso>
        </div>
      </Section>

      <Section id="cerrar-caja" title="8. Cerrar la caja">
        <p className="text-sm text-neutral-600">
          Al final del <Campo>día</Campo> (no en cada cambio de persona — para eso está el Traspaso de turno de
          arriba), para conciliar la plata contra todo lo que se vendió.
        </p>
        <div className="space-y-3">
          <Paso n={1}>Tocá <Boton>Cerrar caja</Boton>.</Paso>
          <Paso n={2}>
            Revisá el resumen: <Campo>Ventas del turno</Campo>, <Campo>Fondo inicial</Campo> y{" "}
            <Campo>Retiros del turno</Campo> (si hiciste alguno).
          </Paso>
          <Paso n={3}>
            Contá toda la plata física del cajón (incluye el fondo inicial) y cargala en{" "}
            <Campo>Efectivo en cajón</Campo>.
          </Paso>
          <Paso n={4}>
            <Campo>Billetera virtual</Campo>, <Campo>Tarjeta</Campo> y <Campo>Transferencia</Campo> los calcula el
            sistema solo a partir de las ventas del turno — no se pueden editar a mano.
          </Paso>
          <Paso n={5}>
            Cargá el <Campo>Fondo para el turno siguiente</Campo>: cuánto efectivo dejás en el cajón para quien abra
            después. El resto queda separado como "sobre" (ver más abajo).
          </Paso>
          <Paso n={6}>
            Mirá la <Campo>diferencia</Campo>: compara lo que declaraste contra lo que el sistema esperaba. Si da
            distinto de $0, revisá si te olvidaste de cargar alguna venta o algún retiro antes de confirmar.
          </Paso>
          <Paso n={7}>
            Si queda diferencia (a favor o en contra), el sistema te va a pedir que escribas qué pasó antes de dejarte
            cerrar — no es opcional.
          </Paso>
          <Paso n={8}>Confirmá el cierre.</Paso>
        </div>
        {esVendedor && (
          <Nota tipo="warn">
            Solo podés cerrar la caja si la tenés vos en este momento — porque la abriste, o porque te la traspasaron
            (ver arriba). Si la tiene otra persona, pedile un traspaso primero, o avisale al encargado.
          </Nota>
        )}
        {esEncargado && (
          <Nota tipo="info">
            Como encargado podés cerrar cualquier turno de tu kiosco, sin importar quién lo tenga en ese momento.
          </Nota>
        )}
      </Section>

      <Section id="sobre" title="9. El sobre de efectivo">
        <p className="text-sm text-neutral-600">
          Es la plata en efectivo que queda "de más" después de separar el fondo para el turno siguiente — la que hay
          que entregarle a un socio.
        </p>
        <div className="space-y-3">
          <Paso n={1}>
            Después de cerrar, si corresponde, en <Campo>Historial de cierres</Campo> vas a ver "En sobre: $X".
          </Paso>
          <Paso n={2}>
            Cuando alguien pasa a retirar esa plata, elegí su nombre en el desplegable y tocá{" "}
            <Boton>Marcar retirado</Boton>. Así queda registrado quién se la llevó y cuándo.
          </Paso>
        </div>
        <Nota tipo="info">
          Verificar que el monto recibido coincida con lo declarado lo hace el socio/admin cuando la recibe — eso no
          es algo que tengas que hacer vos.
        </Nota>
      </Section>

      {(esEncargado || esAdmin) && (
        <Section id="pagos-proveedores" title="10. Pagos a proveedores">
          <p className="text-sm text-neutral-600">
            Para registrar cuánto y cómo le pagaste a un proveedor por la mercadería que te entregó. El sistema
            calcula solo cuánto le debés a cada uno, sumando sus entregas y restando lo que ya le pagaste.
          </p>
          <div className="space-y-3">
            <Paso n={1}>
              Entrá a <Campo>Pagos a proveedores</Campo> desde la página del kiosco (junto al botón de Cta.
              Corriente).
            </Paso>
            <Paso n={2}>Buscá al proveedor en la lista — cada uno muestra su saldo pendiente.</Paso>
            <Paso n={3}>Tocá <Boton>Registrar pago</Boton>.</Paso>
            <Paso n={4}>
              Cargá cuánto le pagaste en <Campo>Efectivo</Campo> y/o <Campo>Billetera</Campo> (se puede combinar) y la
              fecha.
            </Paso>
            <Paso n={5}>
              Si el pago corresponde a una entrega puntual, elegila en <Campo>Entrega (opcional)</Campo> — si es un
              pago general a cuenta, dejalo en blanco.
            </Paso>
            <Paso n={6}>Guardá.</Paso>
          </div>
          <Nota tipo="info">
            El pago en efectivo de este mismo turno se descuenta solo de lo que el sistema espera encontrar en el
            cajón al cerrar la caja — no hace falta cargarlo también como retiro aparte.
          </Nota>
        </Section>
      )}

      {(esEncargado || esAdmin) && (
        <Section id="socios" title="11. Socios (retiros y devoluciones)">
          <p className="text-sm text-neutral-600">
            Para cuando un socio (Damián, Javier, Gabriel) saca plata del cajón para su cuenta personal, y para
            cuando la devuelve.
          </p>
          <div className="space-y-3">
            <Paso n={1}>
              Entrá a <Campo>Socios</Campo> desde la página del kiosco (junto a Pagos a proveedores).
            </Paso>
            <Paso n={2}>Buscá al socio en la lista.</Paso>
            <Paso n={3}>Tocá <Boton>Retiro / devolución</Boton>.</Paso>
            <Paso n={4}>
              Para un retiro: elegí el tipo —{" "}
              <Campo>Temporal (a devolver)</Campo> si es un préstamo que se espera que vuelva, o{" "}
              <Campo>Reparto de ganancias</Campo> si es plata que no vuelve — y cargá el monto.
            </Paso>
            <Paso n={5}>
              Para una devolución: cargá cuánto devolvió en <Campo>Efectivo</Campo> y/o <Campo>Billetera</Campo>.
            </Paso>
            <Paso n={6}>Guardá.</Paso>
          </div>
          <Nota tipo="warn">
            Solo cuenta como "saldo pendiente" un retiro <Campo>Temporal</Campo> — el reparto de ganancias queda
            registrado en el historial, pero nunca te va a pedir que se devuelva.
          </Nota>
        </Section>
      )}

      <Section id="stock" title="12. Consultar el stock">
        <p className="text-sm text-neutral-600">
          Desde el menú <Campo>Stock</Campo> ves cuánto hay de cada producto en tu kiosco, calculado a partir del
          historial de movimientos (recepciones menos ventas y mermas).
        </p>
        <Nota tipo="warn">
          Es de solo lectura: si un número no te cierra, avisale al admin para que lo revise o haga un ajuste.
        </Nota>
      </Section>

      {(esEncargado || esAdmin) && (
        <Section id="pronostico" title="13. Pronóstico">
          <p className="text-sm text-neutral-600">
            Te sugiere cuánto vas a vender de cada producto al día siguiente, calculado con el promedio de ventas de
            ese mismo día de la semana en semanas anteriores. Sirve como referencia para saber qué pedirle al
            proveedor.
          </p>
        </Section>
      )}

      {esAdmin && (
        <Section id="sueldos" title="14. Sueldos por empleado">
          <p className="text-sm text-neutral-600">
            Para llevar el sueldo de cada persona por separado dentro de Finanzas, en vez de un monto suelto sin
            saber a quién corresponde.
          </p>
          <div className="space-y-3">
            <Paso n={1}>Entrá a <Campo>Finanzas</Campo> → <Boton>Nuevo gasto</Boton>.</Paso>
            <Paso n={2}>Elegí la categoría <Campo>Sueldos</Campo>.</Paso>
            <Paso n={3}>Cargá el monto y la fecha.</Paso>
            <Paso n={4}>
              Elegí el <Campo>Empleado</Campo> y si es <Campo>Regular</Campo> (el sueldo normal) o{" "}
              <Campo>Extra</Campo> (una cobertura de turno, un evento puntual, etc.).
            </Paso>
            <Paso n={5}>Guardá.</Paso>
          </div>
        </Section>
      )}

      <Section id="faq" title="Preguntas frecuentes">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-neutral-800">"No hay caja abierta. Registrá una apertura antes de vender"</p>
            <p className="text-sm text-neutral-600 mt-0.5">Te falta abrir la caja del día — es el primer paso (ver arriba).</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-800">¿Hay que cerrar la caja cuando cambia quién atiende?</p>
            <p className="text-sm text-neutral-600 mt-0.5">
              No. Desde ahora se hace un <Campo>Traspaso de turno</Campo> (ver arriba) — cerrar caja es solo una vez
              al día, al terminar.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-800">"Esta caja la tiene [otra persona]" al querer cerrarla</p>
            <p className="text-sm text-neutral-600 mt-0.5">
              Un vendedor solo puede cerrar la caja si la tiene él en este momento. Pedile un{" "}
              <Campo>Traspaso de turno</Campo> a quien la tiene, o que la cierre el encargado.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-800">Un producto figura "Agotado" pero hay stock físico</p>
            <p className="text-sm text-neutral-600 mt-0.5">
              Avisale al admin — puede ser un desfasaje entre lo cargado y lo real, y el ajuste de stock es exclusivo
              de administración.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-800">"La caja de ese turno ya está cerrada -- no se puede anular"</p>
            <p className="text-sm text-neutral-600 mt-0.5">
              Solo se puede anular una venta mientras la caja de ese turno siga abierta. Si ya se cerró, avisale al
              admin para que lo revise.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-800">La diferencia del cierre da negativa</p>
            <p className="text-sm text-neutral-600 mt-0.5">
              Falta plata respecto a lo que el sistema esperaba. Antes de confirmar, revisá si te olvidaste de cargar
              algún retiro o alguna venta del turno.
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}
