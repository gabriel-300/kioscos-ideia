import type { TramoHorario } from "@/lib/pedidos/horario";

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
};

export type Pantalla = "catalogo" | "carrito" | "checkout" | "confirmacion";

export type PedidoConfirmado = {
  numero:      number;
  total:       number;
  subtotal:    number;
  costoEnvio:  number;
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
