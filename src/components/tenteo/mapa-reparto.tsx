"use client";

import { useEffect, useRef, useState } from "react";

// Mapa chico con dos puntos: el repartidor (se mueve) y, si se conoce, el lugar de entrega. OpenStreetMap
// con Leaflet cargado de cdnjs al momento de usarlo (gratis, sin API key, sin dependencia nueva en el
// proyecto). El proyecto no define Content-Security-Policy, así que no hace falta habilitar nada.
// Si Leaflet o los mosaicos no cargan, se muestra el enlace al mapa en lugar de romper la página.

const LEAFLET_VERSION = "1.9.4";
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSION}`;

type Punto = { lat: number; lng: number };

let promesaLeaflet: Promise<any> | null = null;
function cargarLeaflet(): Promise<any> {
  if ((window as any).L) return Promise.resolve((window as any).L);
  if (promesaLeaflet) return promesaLeaflet;
  promesaLeaflet = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${BASE}/leaflet.min.css`;
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = `${BASE}/leaflet.min.js`;
    js.onload = () => resolve((window as any).L);
    js.onerror = () => { promesaLeaflet = null; reject(new Error("leaflet")); };
    document.head.appendChild(js);
  });
  return promesaLeaflet;
}

const iconoPunto = (L: any, color: string, texto: string) =>
  L.divIcon({
    className: "",
    html: `<div style="width:30px;height:30px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-size:15px">${texto}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

export function MapaReparto({ repartidor, destino, altura = 260 }: { repartidor: Punto; destino?: Punto | null; altura?: number }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<any>(null);
  const marcadores = useRef<{ rep?: any; dest?: any }>({});
  const [fallo, setFallo] = useState(false);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let vivo = true;
    cargarLeaflet()
      .then((L) => {
        if (!vivo || !contenedor.current || mapa.current) return;
        mapa.current = L.map(contenedor.current, { zoomControl: true, attributionControl: true }).setView([repartidor.lat, repartidor.lng], 15);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(mapa.current);
        setListo(true);
      })
      .catch(() => { if (vivo) setFallo(true); });
    return () => { vivo = false; mapa.current?.remove(); mapa.current = null; marcadores.current = {}; };
    // el mapa se crea una sola vez; los puntos se actualizan en el efecto de abajo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const L = (window as any).L;
    if (!mapa.current || !L) return;
    const m = marcadores.current;
    if (m.rep) m.rep.setLatLng([repartidor.lat, repartidor.lng]);
    else m.rep = L.marker([repartidor.lat, repartidor.lng], { icon: iconoPunto(L, "#ea580c", "🛵"), keyboard: false }).addTo(mapa.current);
    if (destino) {
      if (m.dest) m.dest.setLatLng([destino.lat, destino.lng]);
      else m.dest = L.marker([destino.lat, destino.lng], { icon: iconoPunto(L, "#16a34a", "🏠"), keyboard: false }).addTo(mapa.current);
      mapa.current.fitBounds([[repartidor.lat, repartidor.lng], [destino.lat, destino.lng]], { padding: [40, 40], maxZoom: 16 });
    } else {
      mapa.current.panTo([repartidor.lat, repartidor.lng]);
    }
  }, [repartidor.lat, repartidor.lng, destino?.lat, destino?.lng, listo]);

  if (fallo) {
    return (
      <a
        href={`https://www.openstreetmap.org/?mlat=${repartidor.lat}&mlon=${repartidor.lng}#map=16/${repartidor.lat}/${repartidor.lng}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-xl border border-neutral-200 p-3 text-sm underline"
      >
        Ver dónde está el repartidor en el mapa
      </a>
    );
  }
  return <div ref={contenedor} role="img" aria-label="Mapa con la ubicación del repartidor" style={{ height: altura }} className="w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100" />;
}
