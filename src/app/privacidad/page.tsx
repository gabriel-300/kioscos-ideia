import type { Metadata } from "next";
import { CONTACTO_LEGAL, PaginaLegal } from "@/components/legal/pagina-legal";

export const metadata: Metadata = {
  title: { absolute: "Política de privacidad — Angiru Food" }, // sin el sufijo del sitio general
  description: "Qué datos usa Angiru Food cuando hacés un pedido online, para qué y cómo pedirnos que los borremos.",
  robots: { index: false, follow: true }, // públicas para los clientes, pero que no salgan en las búsquedas de Google
};

export default function PrivacidadPage() {
  return (
    <PaginaLegal titulo="Política de privacidad">
      <p>
        Angiru Food (Posadas, Misiones, Argentina) vende comida y la entrega por pedidos online a través de
        <strong> www.angirufood.com.ar</strong> y de WhatsApp. Esta página explica qué datos tuyos usamos, para qué y qué derechos tenés.
      </p>

      <h2>Qué datos recibimos</h2>
      <ul>
        <li><strong>Para hacer un pedido:</strong> tu nombre, tu número de WhatsApp y lo que pedís. No hace falta crear una cuenta.</li>
        <li><strong>Si pedís con envío:</strong> tu dirección y la referencia que escribas. Si tocás &ldquo;Usar mi ubicación actual&rdquo;, también el punto de mapa (GPS) desde donde pedís, para que el repartidor te encuentre.</li>
        <li><strong>Si ingresás con Google:</strong> tu nombre y tu correo electrónico, que Google nos informa cuando vos lo autorizás. No recibimos tu contraseña de Google ni acceso a tus otros datos de Google.</li>
        <li><strong>Si nos escribís por WhatsApp:</strong> tu número y los mensajes que mandes al asistente de pedidos o al local.</li>
      </ul>

      <h2>Para qué los usamos</h2>
      <ul>
        <li>Preparar, cobrar y entregar tu pedido, y avisarte cómo va.</li>
        <li>Aplicar los beneficios para clientes registrados (por ejemplo, el descuento de la primera compra).</li>
        <li>Atender tus consultas y reclamos.</li>
        <li>Cumplir obligaciones contables e impositivas.</li>
      </ul>
      <p>No vendemos tus datos ni los usamos para publicidad de terceros.</p>

      <h2>Pagos</h2>
      <p>
        Los pagos online se hacen con <strong>Mercado Pago</strong>. Los datos de tu tarjeta los ingresás en Mercado Pago:
        nosotros no los vemos ni los guardamos. Solo recibimos la confirmación de que el pago se acreditó.
      </p>

      <h2>Tu ubicación</h2>
      <p>
        La ubicación es opcional y solo se pide cuando tocás el botón. Cuando la usás para ver qué local te queda más cerca, el cálculo se
        hace en tu celular y no se envía ni se guarda. Cuando la compartís para un envío, se guarda únicamente con ese pedido.
      </p>

      <h2>Con quién compartimos los datos</h2>
      <ul>
        <li>Con el <strong>personal del local y el repartidor</strong>, solo lo necesario para preparar y entregar tu pedido (nombre, teléfono, dirección o mapa).</li>
        <li>Con los <strong>servicios técnicos</strong> que hacen funcionar el sitio: Supabase (base de datos), Cloudflare (alojamiento), Meta/WhatsApp (mensajes), Mercado Pago (cobros) y Google (ingreso con tu cuenta). Cada uno trata los datos según sus propias políticas.</li>
        <li>Con autoridades, cuando una ley o una orden judicial nos lo exija.</li>
      </ul>

      <h2>Cookies y almacenamiento en tu dispositivo</h2>
      <p>
        Usamos el almacenamiento de tu navegador para recordar tu carrito, tus datos de contacto para el próximo pedido, el último local que elegiste, tu último
        pedido y tu sesión si ingresaste con Google. No usamos cookies de publicidad.
      </p>

      <h2>Cuánto tiempo los guardamos</h2>
      <p>
        Guardamos los datos de tus pedidos mientras sean necesarios para atenderte y cumplir las obligaciones contables y legales. Podés pedirnos que
        borremos tus datos personales en cualquier momento (los registros contables de una compra pueden conservarse sin tus datos de contacto).
      </p>

      <h2>Tus derechos</h2>
      <p>
        Podés pedirnos acceder a tus datos, corregirlos o eliminarlos escribiendo a{" "}
        <a href={`mailto:${CONTACTO_LEGAL}`} style={{ color: "var(--color-pd-ember)" }} className="font-bold underline">{CONTACTO_LEGAL}</a>.
        Respondemos en un plazo máximo de 10 días corridos.
      </p>
      <p>
        De acuerdo con la Ley 25.326 de Protección de los Datos Personales, el titular de los datos tiene la facultad de ejercer el derecho de acceso a
        ellos en forma gratuita a intervalos no inferiores a seis meses. La Agencia de Acceso a la Información Pública, en su carácter de órgano de control
        de la Ley 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por
        incumplimiento de las normas vigentes en materia de protección de datos personales.
      </p>

      <h2>Cambios en esta política</h2>
      <p>Si la modificamos, publicamos la nueva versión en esta misma página con la fecha de actualización.</p>

      <h2>Contacto</h2>
      <p>
        Consultas sobre privacidad:{" "}
        <a href={`mailto:${CONTACTO_LEGAL}`} style={{ color: "var(--color-pd-ember)" }} className="font-bold underline">{CONTACTO_LEGAL}</a>.
      </p>
    </PaginaLegal>
  );
}
