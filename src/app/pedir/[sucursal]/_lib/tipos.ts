import type { TramoHorario } from "@/lib/pedidos/horario";
import type { ConfigBeneficio } from "@/lib/pedidos/beneficio-cliente";
import type { LocalCerca } from "@/lib/pedidos/alcance-envio";

export type ItemCatalogo = {
  id:              string; // product_id o promo_id
  esPromo:         boolean;
  name:            string;
  price:           number;
  image:           string | null;
  badge?:          string;
  unit?:           string;
  descripcion?:    string;
  categoriaId:     string;
  categoriaNombre: string;
};

export type CategoriaCatalogo = { id: string; name: string; items: ItemCatalogo[] };

export type ZonaPublica = { id: string; nombre: string; costo: number; etaMin: number; etaMax: number; radioKm: number | null };

// Cliente registrado que está mirando la tienda (null = invitado).
export type ClienteTienda = { nombre: string | null; telefono: string | null; primeraCompra: boolean };

export type ConfigTienda = {
  sucursalId:         string;
  nombre:             string;
  direccion:          string | null;
  localidad:          string | null;
  habilitado:         boolean;
  retiroHabilitado:   boolean;
  deliveryHabilitado: boolean;
  minimoEnvio:        number;
  retiroEtaMin:       number;
  retiroEtaMax:       number;
  whatsapp:           string | null;
  horario:            TramoHorario[] | null;
  zonas:              ZonaPublica[];
  beneficio:          ConfigBeneficio;
  sesionActiva?: boolean; // hay alguien con sesión iniciada (cliente o personal): para mostrar "Salir"
  cliente:            ClienteTienda | null;
  puedeEfectivo?:     boolean; // quien mira ingresó (cliente con Google o personal de esa sucursal): puede elegir efectivo
  efectivoSucursal:   boolean;
  ubicacionLocal?:    { lat: number; lng: number } | null; // dónde queda este local (para medir el alcance del envío)
  localesCercania?:   LocalCerca[]; // todos los locales con pedidos online (para avisar si hay otro más cerca) // la sucursal acepta efectivo (solo lo puede elegir un cliente que ingresó)
};

export type Pantalla = "catalogo" | "carrito" | "checkout" | "confirmacion";

export type PedidoConfirmado = {
  pedidoId:    string;
  numero:      number;
  total:       number;
  subtotal:    number;
  costoEnvio:  number;
  descuento:   number;
  tipoEntrega: "retiro_local" | "delivery";
  zonaNombre:  string | null;
  etaMin:      number | null;
  etaMax:      number | null;
  medioPago:   "efectivo" | "mercadopago_link";
  pagoCon:     number | null;
  checkoutUrl: string | null;
  lineas:      { nombre: string; cantidad: number; subtotal: number }[];
  cliente:     { nombre: string; whatsapp: string };
  direccion:   string | null;
  referencia:  string | null;
  notas:       string | null;
};

export type FormCheckout = {
  modo:       "envio" | "retiro";
  zonaId:     string | null;
  nombre:     string;
  whatsapp:   string;
  pago:       "efectivo" | "mercadopago_link";
  pagoCon:    string;
  notas:      string;
  referencia: string; // aula, piso o dirección del envío: se pide en CADA pedido, nunca se recuerda
};
