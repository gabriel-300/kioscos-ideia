import type { Metadata } from "next";
import { CONTACTO_LEGAL, PaginaLegal } from "@/components/legal/pagina-legal";

export const metadata: Metadata = {
  title: { absolute: "Condiciones del servicio — Angiru Food" }, // sin el sufijo del sitio general
  description: "Condiciones para pedir online en Angiru Food: pedidos, precios, pagos, entregas y consultas.",
  robots: { index: false, follow: true }, // públicas para los clientes, pero que no salgan en las búsquedas de Google
};

export default function TerminosPage() {
  return (
    <PaginaLegal titulo="Condiciones del servicio">
      <p>
        Estas condiciones rigen el uso de <strong>www.angirufood.com.ar</strong> y del asistente de pedidos de WhatsApp de Angiru Food (Posadas, Misiones, Argentina).
        Al hacer un pedido las aceptás.
      </p>

      <h2>Qué ofrecemos</h2>
      <p>Un menú online con retiro en el local o envío a domicilio, según lo que tenga habilitado cada local. No hace falta tener cuenta para pedir.</p>

      <h2>Pedidos, stock y horarios</h2>
      <ul>
        <li>Solo se ofrece lo que hay disponible en cada local. Si algo se agota entre que lo agregás y confirmás, te avisamos al confirmar.</li>
        <li>Cada local tiene sus horarios de atención. Fuera de horario podés armar el pedido y lo preparamos al abrir.</li>
        <li>Los pedidos por peso se arman en gramos y el precio se calcula sobre el peso que elegís.</li>
        <li>El tiempo de preparación o de entrega que se muestra es estimado.</li>
      </ul>

      <h2>Precios y pagos</h2>
      <ul>
        <li>Los precios están en pesos argentinos. El costo del envío, si lo hay, se muestra antes de confirmar.</li>
        <li>El pago se hace online con Mercado Pago (tarjeta, débito o dinero en cuenta). Tu pedido empieza a prepararse cuando el pago se acredita.</li>
        <li>Si el pago no se completa dentro del plazo indicado, el pedido vence y podés hacer uno nuevo.</li>
      </ul>

      <h2>Entregas</h2>
      <p>
        Para los envíos necesitamos una dirección o ubicación correcta y que alguien reciba el pedido. Si no se puede entregar por un dato incorrecto o porque nadie
        atiende, contactanos para resolverlo.
      </p>

      <h2>Problemas con tu pedido</h2>
      <p>
        Si tu pedido llegó incompleto, en mal estado o con un error, escribinos desde la página de seguimiento de tu pedido (&ldquo;Consultar al local por WhatsApp&rdquo;)
        o a{" "}
        <a href={`mailto:${CONTACTO_LEGAL}`} style={{ color: "var(--color-pd-ember)" }} className="font-bold underline">{CONTACTO_LEGAL}</a>{" "}
        y lo resolvemos. Los derechos que te da la Ley de Defensa del Consumidor se mantienen siempre.
      </p>

      <h2>Tus datos</h2>
      <p>
        Usamos tus datos según nuestra <a href="/privacidad" style={{ color: "var(--color-pd-ember)" }} className="font-bold underline">política de privacidad</a>.
      </p>

      <h2>Uso del sitio</h2>
      <p>
        Pedimos usar el sitio de buena fe: no hacer pedidos falsos, no intentar vulnerar su seguridad y no automatizar pedidos masivos. Podemos cancelar un pedido
        que parezca fraudulento.
      </p>

      <h2>Cambios y ley aplicable</h2>
      <p>
        Podemos actualizar estas condiciones; la versión vigente es la publicada en esta página. Rige la ley argentina y, para cualquier controversia,
        los tribunales de la ciudad de Posadas, Misiones, sin perjuicio de los derechos del consumidor.
      </p>
    </PaginaLegal>
  );
}
