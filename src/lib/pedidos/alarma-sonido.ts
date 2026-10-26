// Sonido de alerta de pedido nuevo en Tenteo. Puro: solo describe las notas; quien lo toca (el navegador, con Web
// Audio) está en components/tenteo/aviso-pedidos.tsx. Es una alarma a propósito (dos tonos alternados, rápidos y
// agudos, como una sirena corta) para que se note aunque el personal esté atendiendo a alguien en el mostrador.

export type NotaAlarma = { frecuencia: number; inicio: number; duracion: number }; // en segundos

export const FRECUENCIA_ALTA = 1046; // Do6
export const FRECUENCIA_BAJA = 784;  // Sol5
export const GANANCIA_ALARMA = 0.32; // la onda cuadrada suena más fuerte de lo que dice este número
export const CADA_NOTA_S = 0.22;
export const NOTAS_ALARMA = 10;

export function patronAlarma(): NotaAlarma[] {
  return Array.from({ length: NOTAS_ALARMA }, (_, i) => ({
    frecuencia: i % 2 === 0 ? FRECUENCIA_ALTA : FRECUENCIA_BAJA,
    inicio: i * CADA_NOTA_S,
    duracion: CADA_NOTA_S * 0.92, // un respiro mínimo entre notas, para que se distingan
  }));
}

// Vibración del celular (si el navegador la permite): tres golpes largos.
export const VIBRACION_ALARMA = [400, 150, 400, 150, 400];

export const duracionAlarmaS = () => NOTAS_ALARMA * CADA_NOTA_S;
