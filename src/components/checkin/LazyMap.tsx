import { lazy, Suspense, useEffect, useState } from "react";
import type { MapViewProps } from "./MapView";

// Leaflet acessa `window` ao ser importado: carrega o mapa só no navegador.
const MapView = lazy(() => import("./MapView"));

export function LazyMap(props: MapViewProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const placeholder = (
    <div
      className="flex items-center justify-center rounded-xl border border-border bg-[var(--surface)] text-xs text-muted-foreground"
      style={{ height: props.height ?? 320 }}
    >
      Carregando mapa…
    </div>
  );
  if (!mounted) return placeholder;
  return (
    <Suspense fallback={placeholder}>
      <MapView {...props} />
    </Suspense>
  );
}

export type { MapPlace, MapPoint } from "./MapView";
