import type { TramoHorario } from "@/lib/pedidos/horario";
import type { ConfigBeneficio } from "@/lib/pedidos/beneficio-cliente";

export type ItemCatalogo = {
  id:              string; // product_id o promo_id
  esPromo:         boolean;
  name:            string;
  price:           number;
  image:           string | null;
  badge?:          string;
  unit?:           string;
  categoriaId:     string;
  categoriaNombre: string;
};

export type CategoriaCatalogo = { id: string; name: string; items: ItemCatalogo[] };

export type ZonaPublica = { id: string; nombre: string; costo: number; etaMin: number; etaMax: number };

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
  cliente:            ClienteTienda | null;
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
  lineas:      { nombre: string; cantidad: number; subtotal: number }[];
  cliente:     { nombre: string; whatsapp: string };
  direccion:   string | null;
  referencia:  string | null;
  notas:       string | null;
};

export type FormCheckout = {
  modo:       "envio" | "retiro";
  zonaId:     string | null;
  calle:      string;
  referencia: string;
  nombre:     string;
  whatsapp:   string;
  pago:       "efectivo" | "mercadopago_link";
  pagoCon:    string;
  notas:      string;
};
