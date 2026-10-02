import { useEffect } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Mapa OpenStreetMap (Leaflet). Carregado só no navegador — use <LazyMap />.

export type MapPlace = {
  key: string;
  label: string;
  lat: number;
  lng: number;
  radius: number;
  color: string;
};

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  color: string;
  label: string;
};

export type MapViewProps = {
  places: MapPlace[];
  points?: MapPoint[];
  /** clique no mapa escolhe um ponto (modo configuração) */
  onPick?: (lat: number, lng: number) => void;
  /** foca o mapa neste ponto quando ele mudar */
  focus?: { lat: number; lng: number } | null;
  height?: number;
};

const SAO_PAULO: [number, number] = [-23.5505, -46.6333];

// Marcador em HTML (evita os ícones padrão do Leaflet, que quebram no bundler).
const pinIcon = (color: string, label: string) =>
  L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-100%)">
      <span style="background:${color};color:#fff;font:600 11px/1 'Titillium Web',sans-serif;padding:4px 7px;border-radius:8px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3)">${label}</span>
      <span style="width:2px;height:10px;background:${color}"></span>
      <span style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #fff;margin-top:-2px;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>
    </div>`,
    iconSize: [0, 0],
  });

function FitBounds({ places, points }: { places: MapPlace[]; points: MapPoint[] }) {
  const map = useMap();
  const key = [
    ...places.map((p) => `${p.lat},${p.lng},${p.radius}`),
    ...points.map((p) => `${p.lat},${p.lng}`),
  ].join("|");
  useEffect(() => {
    const coords: L.LatLngExpression[] = [
      ...places.map((p) => [p.lat, p.lng] as [number, number]),
      ...points.map((p) => [p.lat, p.lng] as [number, number]),
    ];
    if (coords.length === 0) return;
    const bounds = L.latLngBounds(coords);
    places.forEach((p) => bounds.extend(L.latLng(p.lat, p.lng).toBounds(p.radius * 2.4)));
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function FocusOn({ focus }: { focus: { lat: number; lng: number } | null | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 16));
  }, [focus, map]);
  return null;
}

function ClickToPick({ onPick }: { onPick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MapView({
  places,
  points = [],
  onPick,
  focus,
  height = 320,
}: MapViewProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border" style={{ height }}>
      <MapContainer
        center={places[0] ? [places[0].lat, places[0].lng] : SAO_PAULO}
        zoom={14}
        scrollWheelZoom={!!onPick}
        style={{ height: "100%", width: "100%", cursor: onPick ? "crosshair" : undefined }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {places.map((p) => (
          <Circle
            key={`c-${p.key}`}
            center={[p.lat, p.lng]}
            radius={p.radius}
            pathOptions={{ color: p.color, fillColor: p.color, fillOpacity: 0.12, weight: 2 }}
          />
        ))}
        {places.map((p) => (
          <Marker
            key={`m-${p.key}`}
            position={[p.lat, p.lng]}
            icon={pinIcon(p.color, p.label)}
            interactive={false}
          />
        ))}
        {points.map((pt) => (
          <CircleMarker
            key={pt.id}
            center={[pt.lat, pt.lng]}
            radius={7}
            pathOptions={{ color: "#fff", weight: 2, fillColor: pt.color, fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {pt.label}
            </Tooltip>
          </CircleMarker>
        ))}
        <FitBounds places={places} points={points} />
        <FocusOn focus={focus} />
        <ClickToPick onPick={onPick} />
      </MapContainer>
    </div>
  );
}
