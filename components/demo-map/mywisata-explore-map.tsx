"use client";

import "@/lib/maplibre-worker";
import { useEffect, useMemo, useRef } from "react";
import { Layer, Map as MapLibre, Marker, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";
import type { Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { Compass, Map as MapIcon, MapPin } from "lucide-react";
import geoJson from "@/lib/demo-map/malaysia-states.json";
import { DEMO_STATES } from "@/lib/demo-map/data";

export const MYWISATA_EXPLORE_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const STATE_SOURCE_ID = "mywisata-states";
const STATE_FILL_LAYER_ID = "mywisata-state-fill";
const STATE_LINE_LAYER_ID = "mywisata-state-line";

type StateFeature = {
  type: "Feature";
  properties: { id: string; name: string };
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  } | {
    type: "MultiPolygon";
    coordinates: number[][][][];
  };
};

type StateFeatureCollection = {
  type: "FeatureCollection";
  features: StateFeature[];
};

type ExploreMapProps = {
  selectedStateId: string | null;
  onSelectState: (stateId: string | null) => void;
  presentation?: "explore" | "events";
  stateEventCounts?: Record<string, number>;
};

const stateFeatureCollection = geoJson as StateFeatureCollection;

function featurePoint(feature: StateFeature): [number, number] {
  const points = feature.geometry.type === "Polygon"
    ? feature.geometry.coordinates.flat()
    : feature.geometry.coordinates.flat(2);
  const longitude = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const latitude = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return [longitude, latitude];
}

const statePoints = new globalThis.Map(stateFeatureCollection.features.map((feature) => [feature.properties.id, featurePoint(feature)]));

function statePoint(stateId: string): [number, number] {
  return statePoints.get(stateId) ?? DEMO_STATES.find((state) => state.id === stateId)?.label ?? [102.5, 4.5];
}

function applyBuildingStyle(map: MapLibreMap): boolean {
  const buildingLayer = map.getLayer("building-3d");
  if (!buildingLayer) return false;
  try {
    map.setLayerZoomRange("building-3d", 12, 24);
    map.setPaintProperty("building-3d", "fill-extrusion-color", "#010066");
    map.setPaintProperty("building-3d", "fill-extrusion-opacity", 0.86);
    return true;
  } catch {
    return false;
  }
}

import { useTranslation } from "react-i18next";

export function MyWisataExploreMap({
  selectedStateId,
  onSelectState,
  presentation = "explore",
  stateEventCounts = {},
}: ExploreMapProps) {
  const { t } = useTranslation("customer");
  const mapRef = useRef<MapRef | null>(null);
  const isEventsMap = presentation === "events";
  const selectedPoint = selectedStateId ? statePoint(selectedStateId) : null;

  const stateFeatures = useMemo(() => stateFeatureCollection, []);

  useEffect(() => {
    if (isEventsMap) return;
    if (!selectedPoint) {
      mapRef.current?.flyTo({ center: [102.5, 4.5], zoom: 5.2, pitch: 48, bearing: -12, duration: 850, essential: true });
      return;
    }
    mapRef.current?.flyTo({
      center: selectedPoint,
      zoom: selectedStateId === "kuala-lumpur" ? 15.2 : 8.2,
      pitch: selectedStateId === "kuala-lumpur" ? 58 : 48,
      bearing: selectedStateId === "kuala-lumpur" ? -18 : -12,
      duration: 950,
      essential: true,
    });
  }, [isEventsMap, selectedPoint, selectedStateId]);

  function handleMapLoad(event: { target: MapLibreMap }) {
    if (isEventsMap) {
      event.target.fitBounds([[99, 0], [120, 8]], {
        padding: { top: 64, right: 36, bottom: 42, left: 36 },
        maxZoom: 5.8,
        duration: 0,
      });
      return;
    }
    applyBuildingStyle(event.target);
  }

  function handleMapClick(event: MapLayerMouseEvent) {
    const stateId = event.features?.[0]?.properties?.id;
    if (typeof stateId === "string") onSelectState(stateId === selectedStateId ? null : stateId);
  }

  return (
    <>
    <div className={`mywisata-explore-map relative w-full overflow-hidden rounded-[1.8rem] border border-primary/20 bg-card shadow-sm ${isEventsMap ? "h-[min(58svh,560px)] min-h-[360px] lg:h-[620px]" : "aspect-[1600/1060] min-h-[440px] sm:min-h-[500px] lg:h-[620px] lg:aspect-auto lg:min-h-0"}`}>
      <style>{`.mywisata-explore-map .maplibregl-canvas-container { overflow: hidden; }`}</style>
      <MapLibre
        ref={mapRef}
        initialViewState={{
          longitude: isEventsMap ? 109 : 102.5,
          latitude: isEventsMap ? 4 : 4.5,
          zoom: isEventsMap ? 4.8 : 5.2,
          pitch: isEventsMap ? 0 : 48,
          bearing: isEventsMap ? 0 : -12,
        }}
        mapStyle={MYWISATA_EXPLORE_MAP_STYLE}
        maxPitch={isEventsMap ? 0 : 70}
        dragRotate={!isEventsMap}
        touchPitch={!isEventsMap}
        attributionControl={false}
        interactiveLayerIds={[STATE_FILL_LAYER_ID]}
        onLoad={handleMapLoad}
        onClick={handleMapClick}
      >
        {isEventsMap && <NavigationControl position="bottom-right" showCompass showZoom={false} />}
        <Source id={STATE_SOURCE_ID} type="geojson" data={stateFeatures}>
          <Layer
            id={STATE_FILL_LAYER_ID}
            type="fill"
            paint={{
              "fill-color": ["case", ["==", ["get", "id"], selectedStateId ?? ""], "#ffcc00", "#dce4ff"],
              "fill-opacity": ["case", ["==", ["get", "id"], selectedStateId ?? ""], 0.16, 0.42],
            }}
          />
          <Layer
            id={STATE_LINE_LAYER_ID}
            type="line"
            paint={{
              "line-color": ["case", ["==", ["get", "id"], selectedStateId ?? ""], "#ffcc00", "#010066"],
              "line-opacity": ["case", ["==", ["get", "id"], selectedStateId ?? ""], 0.96, 0.38],
              "line-width": ["case", ["==", ["get", "id"], selectedStateId ?? ""], 2.8, 1.1],
              "line-blur": ["case", ["==", ["get", "id"], selectedStateId ?? ""], 0.2, 0],
            }}
          />
        </Source>
        {DEMO_STATES.filter((state) => !isEventsMap || (stateEventCounts[state.id] ?? 0) > 0 || state.id === selectedStateId).map((state) => {
          const [longitude, latitude] = isEventsMap ? state.label : statePoint(state.id);
          const isSelected = selectedStateId === state.id;
          return (
            <Marker key={state.id} longitude={longitude} latitude={latitude} anchor={isEventsMap ? "center" : "bottom"}>
              {isEventsMap ? (
                <button
                  type="button"
                  aria-label={t("ui.promotionCampaigns.map.markerLabel", { state: state.name, count: stateEventCounts[state.id] ?? 0 })}
                  aria-pressed={isSelected}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectState(isSelected ? null : state.id);
                  }}
                  className={`grid h-10 min-w-10 place-items-center rounded-full border-2 border-white px-2 text-sm font-extrabold shadow-[0_5px_14px_rgba(1,0,102,0.28)] outline-none transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${isSelected ? "scale-110 bg-accent text-accent-foreground" : "bg-primary text-primary-foreground hover:scale-110"}`}
                >
                  {stateEventCounts[state.id] ?? 0}
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={`Select ${state.name}`}
                  aria-pressed={isSelected}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectState(isSelected ? null : state.id);
                  }}
                  className="group flex flex-col items-center outline-none"
                >
                  {isSelected && <span className="mb-1 max-w-[150px] truncate rounded-full border border-primary bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground shadow-lg">{state.name}</span>}
                  <span className={`grid place-items-center rounded-full border-2 border-white shadow-[0_5px_14px_rgba(1,0,102,0.28)] transition ${isSelected ? "h-11 w-11 bg-accent text-accent-foreground" : "h-7 w-7 bg-primary text-primary-foreground group-hover:scale-110"}`}>
                    <MapPin size={isSelected ? 21 : 14} fill={isSelected ? "currentColor" : "none"} />
                  </span>
                </button>
              )}
            </Marker>
          );
        })}
      </MapLibre>

        <div className="pointer-events-none absolute left-5 top-4 z-10 sm:left-7 sm:top-6">
          <div className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-accent-foreground shadow-lg">{isEventsMap ? <MapIcon size={14} /> : <Compass size={14} />} {t(isEventsMap ? "ui.promotionCampaigns.map.mapLabel" : "ui.map.exploreMap", "Explore the map")}</div>
        </div>
      </div>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className={isEventsMap ? "mt-3 inline-block text-sm leading-5 text-foreground hover:text-primary" : "mt-2 inline-block text-[10px] leading-4 text-muted-foreground hover:text-foreground"}
      >
        {t("ui.map.attribution")}
      </a>
    </>
  );
}
