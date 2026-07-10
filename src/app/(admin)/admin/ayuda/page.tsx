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
    { id: "vender",      label: "Registrar una venta" },
    { id: "recepcion",   label: "Recepción de mercadería" },
    { id: "retiro",      label: "Retiro de efectivo" },
    { id: "merma",       label: "Registrar una merma" },
    { id: "cerrar-caja", label: "Cerrar la caja" },
    { id: "sobre",       label: "El sobre de efectivo" },
    { id: "stock",       label: "Consultar el stock" },
    ...(esEncargado || esAdmin ? [{ id: "pronostico", label: "Pronóstico" }] : []),
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

      <Section id="vender" title="2. Registrar una venta">
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

      <Section id="recepcion" title="3. Recepción de mercadería">
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

      <Section id="retiro" title="4. Retiro de efectivo">
        <p className="text-sm text-neutral-600">
          Para cuando sacás plata del cajón durante el turno (pagar un flete, dar cambio a otra caja, etc.).
        </p>
        <div className="space-y-3">
          <Paso n={1}>Tocá <Boton>Retiro</Boton>.</Paso>
          <Paso n={2}>Cargá el <Campo>monto</Campo> y el <Campo>motivo</Campo>. Opcionalmente podés sacarle una foto al comprobante.</Paso>
          <Paso n={3}>Guardá. Ese monto se descuenta automáticamente de lo que el sistema espera encontrar en el cajón al cerrar.</Paso>
        </div>
      </Section>

      <Section id="merma" title="5. Registrar una merma">
        <p className="text-sm text-neutral-600">
          Para productos rotos, vencidos o perdidos — así el stock queda correcto sin que figure como una venta.
        </p>
        <div className="space-y-3">
          <Paso n={1}>Tocá <Boton>Merma</Boton>.</Paso>
          <Paso n={2}>Elegí el producto y la cantidad que se perdió.</Paso>
          <Paso n={3}>Guardá.</Paso>
        </div>
      </Section>

      <Section id="cerrar-caja" title="6. Cerrar la caja">
        <p className="text-sm text-neutral-600">Al final del turno, para conciliar la plata contra lo que vendiste.</p>
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
          <Paso n={7}>Confirmá el cierre.</Paso>
        </div>
        {esVendedor && (
          <Nota tipo="warn">
            Solo podés cerrar el turno que vos mismo abriste. Si la caja la abrió otra persona, pedile que la cierre
            ella, o avisale al encargado.
          </Nota>
        )}
        {esEncargado && (
          <Nota tipo="info">
            Como encargado podés cerrar cualquier turno de tu kiosco, aunque lo haya abierto otro vendedor.
          </Nota>
        )}
      </Section>

      <Section id="sobre" title="7. El sobre de efectivo">
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

      <Section id="stock" title="8. Consultar el stock">
        <p className="text-sm text-neutral-600">
          Desde el menú <Campo>Stock</Campo> ves cuánto hay de cada producto en tu kiosco, calculado a partir del
          historial de movimientos (recepciones menos ventas y mermas).
        </p>
        <Nota tipo="warn">
          Es de solo lectura: si un número no te cierra, avisale al admin para que lo revise o haga un ajuste.
        </Nota>
      </Section>

      {(esEncargado || esAdmin) && (
        <Section id="pronostico" title="9. Pronóstico">
          <p className="text-sm text-neutral-600">
            Te sugiere cuánto vas a vender de cada producto al día siguiente, calculado con el promedio de ventas de
            ese mismo día de la semana en semanas anteriores. Sirve como referencia para saber qué pedirle al
            proveedor.
          </p>
        </Section>
      )}

      <Section id="faq" title="Preguntas frecuentes">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-neutral-800">"No hay caja abierta. Registrá una apertura antes de vender"</p>
            <p className="text-sm text-neutral-600 mt-0.5">Te falta abrir la caja del día — es el primer paso (ver arriba).</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-800">"Esta caja la abrió [otra persona]" al querer cerrarla</p>
            <p className="text-sm text-neutral-600 mt-0.5">
              Un vendedor solo puede cerrar el turno que abrió él mismo. Pedile a esa persona que la cierre, o que lo
              haga el encargado.
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
