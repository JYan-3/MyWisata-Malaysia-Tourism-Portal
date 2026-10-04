"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent as ReactFormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Eye, EyeOff, GripVertical, ImageOff, Loader2, LocateFixed, Map as MapIcon, Navigation, Pencil, Plus, Search, ShoppingCart, SlidersHorizontal, Sparkles, Star, X } from "lucide-react";
import { MapView, type MapPin } from "@/components/map/map-view";
import { DirectoryPagination } from "@/components/customer/directory-pagination";
import { CATEGORIES, getBookingSlots, searchActivities } from "@/backend/domains/catalogue";
import { TRAVEL_MODES, buildGoogleMapsDirectionsUrl, type TravelModeId } from "@/lib/travel-modes";
import { ORS_PROFILE, buildRouteDepartureTime, type GeoHit, type RouteResult } from "@/lib/routing";
import type { ComputedActivity, SponsoredPlacement } from "@/backend/core/types";
import type { Trip, TripItem } from "@/backend/domains/trips";
import { getTripActivitySublabel, getTripItemTimeBounds, groupTripItemsByDay, formatTripDay, isValidTripCoordinate, computeSwapTargetOrder } from "@/lib/customer/trip-planner";
import { addTripItemAction, deleteTripItemAction, reorderTripItemsAction, updateTripItemLocationAction, updateTripItemScheduleAction } from "../actions";
import { DISTANCE_UNIT_KM } from "@/lib/i18n/invariant-tokens";
import { formatMYR } from "@/lib/i18n/format";
import { useAppDialog } from "@/components/providers/app-dialog";
import { buildItineraryWeatherPlan } from "@/lib/weather/itinerary";
import { useItineraryWeather } from "./use-itinerary-weather";
import { TripWeatherHint, TripWeatherItemMarker } from "./trip-weather-hint";
import { TripWeatherMapOverlay } from "./trip-weather-map-overlay";
import { useWeatherOverlay } from "./use-weather-overlay";
import { useWeatherRadar } from "./use-weather-radar";
import { canUseLiveRadar, defaultOverlayHour } from "@/lib/weather/overlay-time";
import type { WeatherMapMode } from "@/lib/weather/types";
import { TripPlaceFilterPanel } from "./trip-place-filter-panel";
import { DEFAULT_TRIP_PLACE_FILTERS, countActiveTripPlaceFilters, filterAndRankTripPlaces, type TripPlaceFilters } from "./trip-place-discovery";
import { buildSimulatedWeatherOverlay, buildSimulatedWeatherResult, simulatedWeatherConditionKeyForHour } from "./trip-weather-simulation";
import { TripBudgetGuard } from "./trip-budget-guard";
import { useRouter } from "next/navigation";
import { useCart, cartItemKey } from "@/components/providers/cart";
import { resolveTripCheckoutLines } from "@/lib/customer/trip-checkout";

export interface TripStop {
  id: string; // e.g., experience_id or custom id
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
  source: "vendor" | "location";
  locationKind?: "custom" | "gps";
}

interface TripPlanSuggestion {
  productId: string;
  productName: string;
  message: string;
  lat: number;
  lng: number;
  price: number;
  rating: number;
  image: string | null;
  category: string;
}

// local sync hook matching useTrip API
function useSyncTrip(tripId: string, initialItems: TripItem[]) {
  const { alert } = useAppDialog();
  const { t } = useTranslation("customer");
  const [items, setItems] = useState<TripItem[]>(initialItems);

  const stops: TripStop[] = items.map(i => ({
    id: i.id, // using the item id (which matches experience_id or loc-xxx)
    lat: i.lat,
    lng: i.lng,
    label: i.label,
    sublabel: i.sublabel,
    source: i.source,
    locationKind: i.kind
  }));

  const origin = stops.find(s => s.source === "location") || null;

  return {
    items,
    origin,
    stops,
    has: (id: string) => items.some((item) => item.id === id || item.experience_id === id),
    add: async (stop: Omit<TripStop, "id"> & { id?: string }, schedule?: { date: string | null; time?: string | null }) => {
      const tempId = stop.id || ("temp-" + Date.now());
      const newItem: TripItem = {
        id: tempId,
        trip_id: tripId,
        experience_id: stop.source === "vendor" ? tempId : null,
        sequence: items.length,
        scheduled_date: schedule?.date ?? null,
        scheduled_time: schedule?.time ?? null,
        created_at: new Date().toISOString(),
        source: stop.source,
        kind: stop.locationKind,
        lat: stop.lat,
        lng: stop.lng,
        label: stop.label,
        sublabel: stop.sublabel
      };
      setItems(prev => [...prev, newItem]);
      try {
        const stored = await addTripItemAction({
          trip_id: tripId,
          experience_id: stop.source === "vendor" ? stop.id : undefined,
          source: stop.source,
          kind: stop.locationKind,
          lat: stop.lat,
          lng: stop.lng,
          label: stop.label,
          sublabel: stop.sublabel,
          scheduled_date: schedule?.date ?? null,
          scheduled_time: schedule?.time ?? null,
        });
        setItems((current) => current.map((item) => item.id === tempId ? stored : item));
        return stored;
      } catch {
        setItems((current) => current.filter((item) => item.id !== tempId));
        await alert(t("strictMigration.tripPlanner.addFailed"));
        throw new Error("Unable to add trip item");
      }
    },
    remove: async (id: string) => {
      setItems(prev => prev.filter(i => i.id !== id && i.experience_id !== id));
      const target = items.find(i => i.id === id || i.experience_id === id);
      if (target) await deleteTripItemAction(tripId, target.id);
    },
    move: async (from: number, to: number) => {
      const previousItems = items;
      const newItems = [...items];
      const [moved] = newItems.splice(from, 1);
      newItems.splice(to, 0, moved);
      setItems(newItems);
      try {
        await reorderTripItemsAction(tripId, newItems.map(i => i.id));
      } catch {
        setItems(previousItems);
        await alert(t("strictMigration.tripPlanner.scheduleFailed"));
      }
    },
    // Resequences exactly the given ids, in the given order — unlike move()
    // this doesn't need a flat-array index (which would require reading
    // fresh state right after an await, unreliable from a stale closure).
    // Used to put a swapped-in item back into the same day-relative slot the
    // item it replaced held, without touching any other day's ordering.
    reorderIds: async (orderedIds: string[]) => {
      const previousItems = items;
      setItems((prev) => {
        const sequenceById = new Map(orderedIds.map((id, index) => [id, index]));
        return prev.map((item) => (sequenceById.has(item.id) ? { ...item, sequence: sequenceById.get(item.id)! } : item));
      });
      try {
        await reorderTripItemsAction(tripId, orderedIds);
      } catch {
        setItems(previousItems);
        await alert(t("strictMigration.tripPlanner.scheduleFailed"));
      }
    },
    setLocation: async (stop: Omit<TripStop, "id" | "source">) => {
      const locIndex = items.findIndex(i => i.source === "location");
      const tempId = "loc-" + Date.now();
      const newLoc: TripItem = {
        id: tempId,
        trip_id: tripId,
        experience_id: null,
        sequence: locIndex >= 0 ? items[locIndex].sequence : 0,
        scheduled_date: null,
        scheduled_time: null,
        created_at: new Date().toISOString(),
        source: "location",
        kind: stop.locationKind,
        lat: stop.lat,
        lng: stop.lng,
        label: stop.label,
        sublabel: stop.sublabel
      };
      
      const newItems = [...items];
      if (locIndex >= 0) {
        const oldLocId = items[locIndex].id;
        newItems[locIndex] = newLoc;
        setItems(newItems);
        await deleteTripItemAction(tripId, oldLocId);
      } else {
        newItems.unshift(newLoc); // origin is always top conceptually, or just add it
        setItems(newItems);
      }
      
      await addTripItemAction({
        trip_id: tripId,
        source: "location",
        kind: stop.locationKind,
        lat: stop.lat,
        lng: stop.lng,
        label: stop.label,
        sublabel: stop.sublabel
      });
      // if we replaced, we should reorder to ensure sequences match
      if (locIndex >= 0) {
        await reorderTripItemsAction(tripId, newItems.map(i => i.id));
      }
    },
    update: async (id: string, updates: { label: string; lat: number; lng: number }) => {
      setItems(prev => prev.map(i => {
        if (i.id === id || i.experience_id === id) {
          return { ...i, label: updates.label, lat: updates.lat, lng: updates.lng };
        }
        return i;
      }));
      await updateTripItemLocationAction(tripId, id, updates);
    },
    schedule: async (id: string, scheduledDate: string | null, scheduledTime: string | null) => {
      const previous = items.find((item) => item.id === id);
      setItems((current) => current.map((item) => item.id === id ? { ...item, scheduled_date: scheduledDate, scheduled_time: scheduledTime } : item));
      try {
        await updateTripItemScheduleAction(tripId, id, { scheduled_date: scheduledDate, scheduled_time: scheduledTime });
      } catch {
        if (previous) setItems((current) => current.map((item) => item.id === id ? previous : item));
        await alert(t("strictMigration.tripPlanner.scheduleFailed"));
      }
    },
    clear: async () => {
      // not implemented for db for safety, just stub
      await alert(t("ui.trip.deleteFromTripHub"));
    }
  };
}

const KL_CENTER: [number, number] = [3.139, 101.6869];
const ROUTE_TRAFFIC_REFRESH_MS = 5 * 60 * 1000;
const PLACES_PAGE_SIZE = 15;

const MODE_STYLE: Record<TravelModeId, { color: string; dashed?: boolean }> = {
  DRIVING: { color: "#2563EB" },
  WALKING: { color: "#64748b", dashed: true },
  BICYCLING: { color: "#16A34A" },
  TRANSIT: { color: "#010066" },
};

export function MapClient({
  tripData,
  initialItems,
  initialActivities,
  sponsoredPlacements,
  suggestedAtByVendor,
}: {
  tripData: Trip;
  initialItems: TripItem[];
  initialActivities: ComputedActivity[];
  sponsoredPlacements: SponsoredPlacement[];
  suggestedAtByVendor: Record<string, string>;
}) {
  const trip = useSyncTrip(tripData.id, initialItems);
  const { t: tCustomer, i18n } = useTranslation("customer");
  const { alert: showAlert } = useAppDialog();
  const router = useRouter();
  const cart = useCart();
  const [checkingOut, setCheckingOut] = useState(false);
  const [placeFilters, setPlaceFilters] = useState<TripPlaceFilters>(DEFAULT_TRIP_PLACE_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activities, setActivities] = useState<ComputedActivity[] | null>(initialActivities);
  const [mode, setMode] = useState<TravelModeId>("DRIVING");
  const [urlPreview, setUrlPreview] = useState<string | null>(null);

  // Start editor + real-time geocoding autocomplete
  const [editingStart, setEditingStart] = useState(false);
  const [startInput, setStartInput] = useState("");
  const [suggestions, setSuggestions] = useState<GeoHit[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");

  // Add-a-stop search + real-time geocoding autocomplete
  const [addingStop, setAddingStop] = useState(false);
  const [stopSearchInput, setStopSearchInput] = useState("");
  const [stopSuggestions, setStopSuggestions] = useState<GeoHit[]>([]);
  const [stopSearchLoading, setStopSearchLoading] = useState(false);

  // Edit-a-typed-stop search + real-time geocoding autocomplete (vendor stops
  // aren't editable — they're tied to a real listing).
  const [editingStopId, setEditingStopId] = useState<string | null>(null);
  const [editStopInput, setEditStopInput] = useState("");
  const [editStopSuggestions, setEditStopSuggestions] = useState<GeoHit[]>([]);
  const [editStopLoading, setEditStopLoading] = useState(false);

  // Off by default — vendor pins otherwise clutter the map once a trip has stops.
  const [showAllVendors, setShowAllVendors] = useState(false);

  // Per-mode route options (may be several alternatives for a 2-point drive).
  const [routes, setRoutes] = useState<Partial<Record<TravelModeId, RouteResult[]>>>({});
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routeRefreshTick, setRouteRefreshTick] = useState(0);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);

  const [dragPayload, setDragPayload] = useState<{ kind: "item"; itemId: string } | { kind: "catalogue"; activityId: string } | null>(null);
  const [activePanel, setActivePanel] = useState<"ai" | "itinerary" | "places">("itinerary");
  const [aiCollapsed, setAiCollapsed] = useState(false);
  const [placesCollapsed, setPlacesCollapsed] = useState(false);
  const [aiWidth, setAiWidth] = useState(320);
  const aiResizeRef = useRef(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [aiPreference, setAiPreference] = useState("");
  const [aiSuggestions, setAiSuggestions] = useState<TripPlanSuggestion[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [placesPage, setPlacesPage] = useState(1);
  const [focusRequest, setFocusRequest] = useState<{ pin: MapPin; token: number } | null>(null);
  const focusTokenRef = useRef(0);
  // Budget Guard alternatives shown via "Show on map" — kept here (not just
  // focused) so the pin is actually present in `pins` for the popup to find,
  // and so it renders with the distinct "Suggested" marker/badge rather than
  // vanishing once the transient focus highlight ends.
  const [suggestedPins, setSuggestedPins] = useState<MapPin[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(tripData.start_date);
  const [overlayHour, setOverlayHour] = useState(12);
  const [weatherNow, setWeatherNow] = useState(() => new Date());
  const [weatherMapMode, setWeatherMapMode] = useState<WeatherMapMode>(() => canUseLiveRadar(tripData.start_date, weatherNow) ? "now" : "forecast");
  const [weatherLayerEnabled, setWeatherLayerEnabled] = useState(true);
  const simulationAvailable = process.env.NODE_ENV !== "production";
  const [simulationEnabled, setSimulationEnabled] = useState(false);
  const simulationActive = simulationAvailable && simulationEnabled;
  const [mapMoving, setMapMoving] = useState(false);
  const requestedOverlayHourRef = useRef<{ date: string; hour: number } | null>(null);
  const [discoveryNow] = useState(() => new Date().toISOString());
  const impressedPlacementIdsRef = useRef(new Set<string>());

  const plannerGridStyle = {
    "--planner-ai-width": aiCollapsed ? "52px" : `${aiWidth}px`,
    "--planner-places-width": placesCollapsed ? "52px" : "360px",
  } as CSSProperties;

  useEffect(() => {
    if (!selectedDate) return;
    const requestedHour = requestedOverlayHourRef.current;
    requestedOverlayHourRef.current = null;
    if (requestedHour?.date === selectedDate) {
      setOverlayHour(requestedHour.hour);
      return;
    }
    const scheduledTimes = initialItems.filter((item) => item.scheduled_date === selectedDate).map((item) => item.scheduled_time);
    setOverlayHour(defaultOverlayHour({ date: selectedDate, scheduledTimes, now: new Date() }));
  }, [initialItems, selectedDate]);

  useEffect(() => {
    const current = new Date();
    const timer = window.setTimeout(() => setWeatherMapMode(canUseLiveRadar(selectedDate, current) ? "now" : "forecast"), 0);
    return () => window.clearTimeout(timer);
  }, [selectedDate]);

  useEffect(() => {
    const interval = window.setInterval(() => setWeatherNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const liveRadarAvailable = canUseLiveRadar(selectedDate, weatherNow);
  const activeWeatherMapMode: WeatherMapMode = simulationActive ? "forecast" : weatherMapMode === "now" && !liveRadarAvailable ? "forecast" : weatherMapMode;

  // Route origin = the top item of the unified stop list.
  const origin = trip.origin && isValidTripCoordinate(trip.origin.lat, trip.origin.lng) ? trip.origin : null;
  const near = origin ? { lat: origin.lat, lng: origin.lng } : undefined;
  const hasOrigin = origin !== null;
  const selectedRouteStops = useMemo(() => {
    const datedStops = trip.items
      .filter((item) => item.scheduled_date === selectedDate && item.id !== origin?.id && isValidTripCoordinate(item.lat, item.lng))
      .sort((a, b) => a.sequence - b.sequence)
      .map((item): TripStop => ({ id: item.id, lat: item.lat, lng: item.lng, label: item.label, sublabel: item.sublabel, source: item.source, locationKind: item.kind }));
    return origin ? [origin, ...datedStops] : datedStops;
  }, [origin, selectedDate, trip.items]);
  const selectedRouteCoordinates = useMemo(
    () => selectedRouteStops.map((stop): [number, number] => [stop.lat, stop.lng]),
    [selectedRouteStops],
  );

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      if (!near) return;
    }
    searchActivities({ category: null, near, sort: near ? "distance_asc" : "recommended" }).then(setActivities);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.lat, origin?.lng]);

  // Route fetch (debounced): all ORS-supported modes → routes[mode] = options.
  // A route needs at least two points (origin + one more).
  const pointsKey = selectedRouteStops.map((s) => `${s.lat},${s.lng}`).join("|");
  const routeDepartureTime = buildRouteDepartureTime(
    selectedDate,
    trip.items.filter((item) => item.scheduled_date === selectedDate).map((item) => item.scheduled_time),
  );
  useEffect(() => {
    if (selectedRouteStops.length < 2) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") setRouteRefreshTick((current) => current + 1);
    }, ROUTE_TRAFFIC_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [pointsKey, selectedRouteStops.length]);
  const routeRequestKey = `${pointsKey}|${routeDepartureTime ?? "live"}|${routeRefreshTick}`;
  useEffect(() => {
    if (selectedRouteStops.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRoutes({});
      setRoutesLoading(false);
      return;
    }
    const points: [number, number][] = selectedRouteStops.map((s): [number, number] => [s.lat, s.lng]);
    let cancelled = false;
    setRoutesLoading(true);
    setSelectedRouteIdx(0);
    const timer = setTimeout(async () => {
      const supported = TRAVEL_MODES.filter((m) => ORS_PROFILE[m.id]);
      const entries = await Promise.all(
        supported.map(async (m) => {
          try {
            const res = await fetch("/api/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: m.id, points, departureTime: routeDepartureTime }) });
            const body = (await res.json()) as { data: { routes: RouteResult[] } | null };
            return [m.id, res.ok && body.data ? body.data.routes : []] as const;
          } catch {
            return [m.id, [] as RouteResult[]] as const;
          }
        }),
      );
      if (cancelled) return;
      setRoutes(Object.fromEntries(entries));
      setRoutesLoading(false);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeRequestKey]);

  // Real-time geocoding as the user types the start location.
  useEffect(() => {
    if (!editingStart) return;
    const q = startInput.trim();
    if (q.length < 3) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    setGeoLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const body = (await res.json()) as { data: { results: GeoHit[] } | null };
        if (!cancelled) setSuggestions(body.data?.results ?? []);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setGeoLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [startInput, editingStart]);

  // Real-time geocoding as the user types a place to add as a stop.
  useEffect(() => {
    if (!addingStop) return;
    const q = stopSearchInput.trim();
    if (q.length < 3) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStopSuggestions([]);
      return;
    }
    let cancelled = false;
    setStopSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const body = (await res.json()) as { data: { results: GeoHit[] } | null };
        if (!cancelled) setStopSuggestions(body.data?.results ?? []);
      } catch {
        if (!cancelled) setStopSuggestions([]);
      } finally {
        if (!cancelled) setStopSearchLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stopSearchInput, addingStop]);

  // Real-time geocoding as the user re-types a typed stop's location.
  useEffect(() => {
    if (!editingStopId) return;
    const q = editStopInput.trim();
    if (q.length < 3) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditStopSuggestions([]);
      return;
    }
    let cancelled = false;
    setEditStopLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const body = (await res.json()) as { data: { results: GeoHit[] } | null };
        if (!cancelled) setEditStopSuggestions(body.data?.results ?? []);
      } catch {
        if (!cancelled) setEditStopSuggestions([]);
      } finally {
        if (!cancelled) setEditStopLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [editStopInput, editingStopId]);

  const activeRoutes = ORS_PROFILE[mode] ? routes[mode] ?? [] : [];
  const activeRoute = activeRoutes[selectedRouteIdx] ?? activeRoutes[0];

  const locationStop = trip.stops.find((s) => s.source === "location") ?? null;
  function openStartEditor() {
    setStartInput(locationStop?.locationKind === "custom" ? locationStop.label : "");
    setSuggestions([]);
    setLocError("");
    setEditingStart(true);
  }
  function chooseSuggestion(hit: GeoHit) {
    trip.setLocation({ label: hit.label, lat: hit.lat, lng: hit.lng, locationKind: "custom" });
    setEditingStart(false);
    setStartInput("");
    setSuggestions([]);
  }
  function useGps() {
    if (!navigator.geolocation) {
      setLocError("Location isn't available on this device.");
      return;
    }
    setLocating(true);
    setLocError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        trip.setLocation({ label: "Your location", lat: pos.coords.latitude, lng: pos.coords.longitude, locationKind: "gps" });
        setLocating(false);
        setEditingStart(false);
      },
      () => {
        setLocating(false);
        setLocError("Location access was denied.");
      },
      { timeout: 5000 },
    );
  }

  function toggleStop(pin: MapPin) {
    if (pin.replacesId) {
      void swapSuggestedStop(pin, pin.replacesId);
      return;
    }
    if (trip.has(pin.id)) trip.remove(pin.id);
    else trip.add({ id: pin.id, lat: pin.lat, lng: pin.lng, label: pin.label, sublabel: pin.sublabel, source: "vendor" });
  }

  // Budget Guard "Suggested" pin: replace the real over-budget item in its
  // exact day/sequence slot, rather than removing nothing and appending the
  // suggestion as a new unscheduled item.
  async function swapSuggestedStop(pin: MapPin, replacesId: string) {
    const existing = trip.items.find((item) => item.id === replacesId || item.experience_id === replacesId);
    if (!existing) {
      // The item it was meant to replace isn't in the trip anymore — nothing to swap into, just add it normally.
      if (!trip.has(pin.id)) trip.add({ id: pin.id, lat: pin.lat, lng: pin.lng, label: pin.label, sublabel: pin.sublabel, source: "vendor" });
      return;
    }
    const schedule = { date: existing.scheduled_date, time: existing.scheduled_time };
    // Captured BEFORE mutating — the day's real item order with the removed
    // item's slot replaced by the new one, used to reorder into place after.
    const targetOrder = computeSwapTargetOrder(trip.items, existing.id, pin.id);

    await trip.remove(existing.id);
    await trip.add({ id: pin.id, lat: pin.lat, lng: pin.lng, label: pin.label, sublabel: pin.sublabel, source: "vendor" }, schedule);
    if (targetOrder && targetOrder.length > 1) await trip.reorderIds(targetOrder);
  }
  function chooseStopSuggestion(hit: GeoHit) {
    trip.add({ lat: hit.lat, lng: hit.lng, label: hit.label, source: "location", locationKind: "custom" });
    setAddingStop(false);
    setStopSearchInput("");
    setStopSuggestions([]);
  }
  function openStopEditor(stop: TripStop) {
    setEditingStopId(stop.id);
    setEditStopInput(stop.label);
    setEditStopSuggestions([]);
  }
  function chooseStopEditSuggestion(hit: GeoHit) {
    if (editingStopId) trip.update(editingStopId, { label: hit.label, lat: hit.lat, lng: hit.lng });
    setEditingStopId(null);
    setEditStopInput("");
    setEditStopSuggestions([]);
  }
  function focusPin(pin: MapPin) {
    focusTokenRef.current += 1;
    setFocusRequest({ pin, token: focusTokenRef.current });
    setMapExpanded(true);
    setActivePanel("itinerary");
  }

  function patchPlaceFilters(patch: Partial<TripPlaceFilters>) {
    setPlaceFilters((current) => ({ ...current, ...patch }));
    setPlacesPage(1);
  }

  function clearPlaceFilters() {
    setPlaceFilters(DEFAULT_TRIP_PLACE_FILTERS);
    setPlacesPage(1);
  }

  function recordSponsoredEvent(placementId: string, eventType: "impression" | "click", productId: string) {
    void fetch(`/api/sponsored-placements/${placementId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, productId }),
    }).catch(() => undefined);
  }

  // Geocode dropdown for the location editor — shared by the "no location yet"
  // placeholder and the location row's inline edit form.
  function locationSuggestions() {
    return (
      <div className="mt-1.5">
        {geoLoading && <p className="px-1 py-1 text-[11px] text-muted-foreground">{tCustomer("ui.map.searching")}</p>}
        {!geoLoading && startInput.trim().length >= 3 && suggestions.length === 0 && <p className="px-1 py-1 text-[11px] text-muted-foreground">{tCustomer("ui.map.noMatches")}</p>}
        {suggestions.length > 0 && (
          <ul className="overflow-hidden rounded-lg border border-border bg-card">
            {suggestions.map((s, i) => (
              <li key={`${s.lat},${s.lng},${i}`}>
                <button onClick={() => chooseSuggestion(s)} className="flex w-full items-start gap-2 border-b border-border px-2.5 py-2 text-left last:border-0 hover:bg-muted">
                  <LocateFixed size={12} className="mt-0.5 shrink-0 text-primary" />
                  <span className="break-words whitespace-normal text-[12px] text-foreground">{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const filteredActivities = useMemo(() => filterAndRankTripPlaces({
    activities: activities ?? [],
    filters: placeFilters,
    hasOrigin,
    placements: sponsoredPlacements,
    suggestedAtByVendor,
    now: discoveryNow,
  }), [activities, discoveryNow, hasOrigin, placeFilters, sponsoredPlacements, suggestedAtByVendor]);
  const activePlaceFilterCount = countActiveTripPlaceFilters(placeFilters);
  const groupedItems = useMemo(
    () => groupTripItemsByDay(tripData, trip.items),
    [trip.items, tripData],
  );
  const selectedDay = groupedItems.days.find((day) => day.date === selectedDate) ?? groupedItems.days[0] ?? null;
  const selectedDayIndex = selectedDay ? groupedItems.days.findIndex((day) => day.date === selectedDay.date) : -1;
  const placesTotalPages = Math.max(1, Math.ceil(filteredActivities.length / PLACES_PAGE_SIZE));
  const safePlacesPage = Math.min(placesPage, placesTotalPages);
  const placesPageStart = (safePlacesPage - 1) * PLACES_PAGE_SIZE;
  const visibleActivitiesPage = filteredActivities.slice(placesPageStart, placesPageStart + PLACES_PAGE_SIZE);
  useEffect(() => {
    for (const activity of visibleActivitiesPage) {
      const placementId = activity.sponsorship?.placementId;
      if (!placementId || impressedPlacementIdsRef.current.has(placementId)) continue;
      impressedPlacementIdsRef.current.add(placementId);
      void fetch(`/api/sponsored-placements/${placementId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: "impression", productId: activity.id }),
      }).catch(() => undefined);
    }
  }, [visibleActivitiesPage]);
  const activitiesById = useMemo(
    () => new Map([...initialActivities, ...(activities ?? [])].map((activity) => [activity.id, activity])),
    [activities, initialActivities],
  );
  // Checks out every scheduled stop in one go: real vendor items go straight
  // into the cart, a stop that requires booking is only ever matched to a
  // real open `booking_slots` row on its exact scheduled day (never a
  // fabricated or shifted one) — anything that can't be matched is reported,
  // not silently dropped or silently mis-booked.
  async function handleCheckout() {
    if (checkingOut) return;
    const scheduledItems = trip.items.filter((item) => item.scheduled_date && item.experience_id);
    if (scheduledItems.length === 0) return;
    setCheckingOut(true);
    try {
      const bookingActivityIds = [...new Set(
        scheduledItems
          .map((item) => activitiesById.get(item.experience_id!))
          .filter((activity): activity is ComputedActivity => Boolean(activity?.requiresBooking))
          .map((activity) => activity.id),
      )];
      const slotLists = await Promise.all(bookingActivityIds.map((id) => getBookingSlots(id)));
      const slotsByActivityId = new Map(bookingActivityIds.map((id, index) => [id, slotLists[index]]));

      const { lines, needsSlot } = resolveTripCheckoutLines(scheduledItems, activitiesById, slotsByActivityId);
      if (lines.length === 0) {
        await showAlert(needsSlot.length > 0 ? tCustomer("ui.tripCheckout.allNeedSlot") : tCustomer("ui.tripCheckout.nothingToCheckout"));
        return;
      }

      const addedKeys: string[] = [];
      for (const line of lines) {
        await cart.addItem({ activityId: line.activityId, variantId: line.variantId, outletId: line.outletId, slotId: line.slotId, qty: line.qty });
        addedKeys.push(cartItemKey(line));
      }
      cart.setSelectedKeys(addedKeys);

      if (needsSlot.length > 0) {
        await showAlert(tCustomer("ui.tripCheckout.someNeedSlot", { names: needsSlot.map((entry) => entry.label).join(", ") }));
      }
      router.push("/customer/cart");
    } finally {
      setCheckingOut(false);
    }
  }
  const weatherPlan = useMemo(
    () => buildItineraryWeatherPlan(groupedItems.days, activitiesById),
    [activitiesById, groupedItems.days],
  );
  const weatherState = useItineraryWeather(tripData.id, weatherPlan.targets);
  const simulatedWeatherResult = simulationActive && selectedDate
    ? buildSimulatedWeatherResult(selectedDate, overlayHour)
    : null;
  const simulationAnchor = selectedRouteStops[0] ?? null;
  const simulatedWeatherOverlay = useMemo(() => (
    simulationActive && selectedDate && simulationAnchor
      ? buildSimulatedWeatherOverlay(selectedDate, overlayHour, simulationAnchor)
      : null
  ), [overlayHour, selectedDate, simulationActive, simulationAnchor]);
  const overlayState = useWeatherOverlay(
    tripData.id,
    selectedDate,
    overlayHour,
    weatherLayerEnabled && activeWeatherMapMode === "forecast" && !simulationActive,
    selectedRouteStops.length > 0,
  );
  const displayedWeatherOverlay = simulationActive ? simulatedWeatherOverlay : overlayState.result;
  const displayedWeatherOverlayStatus = simulationActive
    ? simulatedWeatherOverlay ? "ready" as const : "missing_coordinates" as const
    : overlayState.status;
  const radarState = useWeatherRadar(tripData.id, weatherLayerEnabled && activeWeatherMapMode === "now" && liveRadarAvailable);
  const weatherTargetsByKey = useMemo(
    () => new Map(weatherPlan.targets.map((target) => [target.key, target])),
    [weatherPlan.targets],
  );
  const scheduledItemCount = trip.items.filter((item) => item.scheduled_date).length;
  const center: [number, number] = near ? [near.lat, near.lng] : KL_CENTER;
  // Trip-stop pins always render (numbered markers matching the list order);
  // vendor "browse to add" pins are opt-in via showAllVendors, off by default so
  // the map doesn't get cluttered once a trip actually has stops.
  const stopIdSet = new Set(trip.items.map((item) => item.experience_id ?? item.id));
  const stopPins: MapPin[] = selectedRouteStops.map((s, index) => {
    const activity = activitiesById.get(s.id) ?? (s.source === "vendor" ? activitiesById.get(trip.items.find((item) => item.id === s.id)?.experience_id ?? "") : undefined);
    return { id: s.id, lat: s.lat, lng: s.lng, label: s.label, sublabel: activity ? getTripActivitySublabel(activity, s.sublabel, formatMYR, tCustomer("ui.map.addPlace")) : s.sublabel, imageUrl: activity?.image, order: index + 1 };
  });
  const vendorPins: MapPin[] = showAllVendors
    ? filteredActivities.filter((a) => !stopIdSet.has(a.id)).map((a) => ({ id: a.id, lat: a.outlet.lat, lng: a.outlet.lng, label: a.name, sublabel: `${formatMYR(Number(a.price))} · ${a.outlet.city}`, href: `/customer/activity/${a.id}`, imageUrl: a.image }))
    : [];
  const pins: MapPin[] = [...stopPins, ...vendorPins, ...suggestedPins.filter((p) => !stopIdSet.has(p.id) && !vendorPins.some((v) => v.id === p.id))];

  const directionsUrl = buildGoogleMapsDirectionsUrl(origin, selectedRouteStops.filter((stop) => stop.id !== origin?.id), mode);
  const hasRouteInputs = selectedRouteStops.length >= 2;
  function formatDuration(minutes: number) {
    if (minutes < 60) return tCustomer("ui.map.durationMinutes", { minutes });
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? tCustomer("ui.map.durationHoursMinutes", { hours, minutes: remainder }) : tCustomer("ui.map.durationHours", { hours });
  }
  function formatDurationShort(minutes: number) {
    if (minutes < 60) return tCustomer("ui.map.durationMinutesShort", { minutes });
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? tCustomer("ui.map.durationHoursMinutesShort", { hours, minutes: remainder }) : tCustomer("ui.map.durationHoursShort", { hours });
  }
  function travelModeLabel(id: TravelModeId) {
    return tCustomer(`ui.map.travelModes.${id.toLowerCase()}`);
  }

  function handleAiResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    aiResizeRef.current = true;
    const startX = event.clientX;
    const startWidth = aiWidth;
    function onMove(moveEvent: PointerEvent) {
      if (!aiResizeRef.current) return;
      setAiWidth(Math.max(260, Math.min(520, startWidth + moveEvent.clientX - startX)));
    }
    function onUp() {
      aiResizeRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function requestAiPlan(event?: ReactFormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (aiLoading) return;
    setAiLoading(true);
    setAiError("");
    try {
      const language = i18n.resolvedLanguage ?? i18n.language;
      const locale = language.toLowerCase().startsWith("zh") ? "zh-CN" : language.toLowerCase().startsWith("ms") || language.toLowerCase().startsWith("bm") ? "ms" : "en";
      const response = await fetch("/api/trips/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ tripId: tripData.id, preference: aiPreference.trim(), locale }),
      });
      const body = await response.json() as { data?: { suggestions?: TripPlanSuggestion[] }; error?: { code?: string } };
      if (!response.ok || !body.data) {
        setAiSuggestions([]);
        setAiError(body.error?.code === "PHONE_VERIFICATION_REQUIRED"
          ? tCustomer("strictMigration.tripPlanner.ai.verifyPhone")
          : tCustomer("strictMigration.tripPlanner.ai.error"));
        return;
      }
      setAiSuggestions(body.data.suggestions ?? []);
    } catch {
      setAiSuggestions([]);
      setAiError(tCustomer("strictMigration.tripPlanner.ai.error"));
    } finally {
      setAiLoading(false);
    }
  }

  function addAiSuggestion(suggestion: TripPlanSuggestion) {
    if (trip.has(suggestion.productId)) return;
    void trip.add({
      id: suggestion.productId,
      lat: suggestion.lat,
      lng: suggestion.lng,
      label: suggestion.productName,
      sublabel: `${formatMYR(suggestion.price)} · ${suggestion.category}`,
      source: "vendor",
    }, { date: selectedDate });
    setActivePanel("itinerary");
  }

  function renderTravelLeg(fromId: string, toId: string, index: number) {
    const leg = activeRoute?.legs?.[index];
    const ModeIcon = TRAVEL_MODES.find((travelMode) => travelMode.id === mode)?.icon ?? Navigation;
    return (
      <li key={`leg-${fromId}-${toId}`} data-trip-leg className="flex items-center gap-2 pl-4 text-[11px] text-muted-foreground">
        <span className="h-5 border-l border-dashed border-border" aria-hidden="true" />
        <ModeIcon size={12} className="shrink-0 text-primary" />
        <span className="font-semibold">{travelModeLabel(mode)}</span>
        {leg && <span>· {formatDurationShort(leg.durationMin)} · {leg.distanceKm.toFixed(1)} {DISTANCE_UNIT_KM}</span>}
        {!leg && routesLoading && mode !== "TRANSIT" && <span>· {tCustomer("strictMigration.tripPlanner.ai.calculating")}</span>}
        {!leg && mode === "TRANSIT" && <span>· {tCustomer("ui.map.maps")}</span>}
      </li>
    );
  }
  function activityStop(activity: ComputedActivity): Omit<TripStop, "id"> & { id: string } {
    return { id: activity.id, lat: activity.outlet.lat, lng: activity.outlet.lng, label: activity.name, sublabel: `${formatMYR(Number(activity.price))} · ${activity.outlet.city}`, source: "vendor" };
  }

  function chooseDayForActivity(activity: ComputedActivity, date: string) {
    if (!trip.has(activity.id)) trip.add(activityStop(activity), { date });
    setSelectedDate(date);
    setActivePanel("itinerary");
  }

  function handleSelectWeatherRiskHour(date: string, hour: number) {
    requestedOverlayHourRef.current = { date, hour };
    setSelectedDate(date);
    setWeatherLayerEnabled(true);
    setWeatherMapMode("forecast");
    setOverlayHour(hour);
    setMapExpanded(true);
    setActivePanel("itinerary");
  }

  function handleDropOnDay(date: string | null) {
    if (!dragPayload) return;
    if (dragPayload.kind === "item") {
      const item = trip.items.find((entry) => entry.id === dragPayload.itemId);
      if (item) trip.schedule(item.id, date, item.scheduled_time);
    } else {
      const activity = activitiesById.get(dragPayload.activityId);
      if (activity && !trip.has(activity.id)) trip.add(activityStop(activity), { date });
    }
    if (date) setSelectedDate(date);
    setDragPayload(null);
  }

  function handleDropOnItem(targetId: string) {
    if (!dragPayload || dragPayload.kind !== "item" || dragPayload.itemId === targetId) {
      setDragPayload(null);
      return;
    }
    const from = trip.items.findIndex((item) => item.id === dragPayload.itemId);
    const to = trip.items.findIndex((item) => item.id === targetId);
    trip.move(from, to);
    setDragPayload(null);
  }

  function renderStopRow(item: TripItem) {
    const stopNumber = selectedRouteStops.findIndex((stop) => stop.id === item.id) + 1;
    const isLocation = item.source === "location";
    const isCustom = isLocation && item.id !== trip.origin?.id;
    const editing = editingStopId === item.id || (isLocation && editingStart);
    const weatherTargetKey = weatherPlan.itemTargetKeyById[item.id];
    const weatherResult = weatherTargetKey ? weatherState.results[weatherTargetKey] ?? null : null;
    const activity = activitiesById.get(item.experience_id ?? item.id);
    const timeBounds = getTripItemTimeBounds(trip.items, item.id);
    const sublabel = isLocation
      ? (item.kind === "gps" ? tCustomer("ui.map.currentLocation") : tCustomer("ui.map.customStart"))
      : getTripActivitySublabel(activity, item.sublabel, formatMYR, tCustomer("ui.map.addPlace"));

    return (
      <li
        key={item.id}
        draggable
        onDragStart={() => setDragPayload({ kind: "item", itemId: item.id })}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => handleDropOnItem(item.id)}
        onDragEnd={() => setDragPayload(null)}
        className={"rounded-xl border bg-card p-2.5 transition " + (dragPayload?.kind === "item" && dragPayload.itemId === item.id ? "opacity-40" : "border-border hover:border-primary/40")}
      >
        {editing ? (
          <div>
            <div className="flex items-center gap-2">
              <GripVertical size={14} className="shrink-0 cursor-grab text-muted-foreground" />
              <input
                autoFocus
                value={isLocation ? startInput : editStopInput}
                onChange={(event) => isLocation ? setStartInput(event.target.value) : setEditStopInput(event.target.value)}
                placeholder={tCustomer("strictMigration.tripPlanner.searchNewLocation")}
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              <button onClick={() => isLocation ? setEditingStart(false) : setEditingStopId(null)} className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label={tCustomer("ui.map.cancelEdit")}>
                <X size={14} />
              </button>
            </div>
            {isLocation ? locationSuggestions() : (
              <div className="mt-2">
                {editStopLoading && <p className="text-xs text-muted-foreground">{tCustomer("ui.map.searching")}</p>}
                {editStopSuggestions.length > 0 && (
                  <ul className="overflow-hidden rounded-lg border border-border bg-card">
                    {editStopSuggestions.map((suggestion, index) => (
                      <li key={suggestion.lat + "," + suggestion.lng + "," + index}>
                        <button onClick={() => chooseStopEditSuggestion(suggestion)} className="flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left text-xs last:border-0 hover:bg-muted">
                          <LocateFixed size={13} className="mt-0.5 shrink-0 text-primary" />
                          <span className="break-words whitespace-normal">{suggestion.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <GripVertical size={14} className="shrink-0 cursor-grab text-muted-foreground" />
            {activity?.image ? <span data-itinerary-image={item.id} className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-secondary"><Image src={activity.image} alt="" width={40} height={40} unoptimized className="h-full w-full object-cover" /><b className="absolute bottom-0.5 left-0.5 grid h-4 min-w-4 place-items-center rounded-full border border-white bg-primary px-0.5 text-[8px] text-white">{stopNumber > 0 ? stopNumber : "–"}</b></span> : <span className={"grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold text-white " + (isLocation ? "bg-[#16A34A]" : "bg-primary")}>{stopNumber > 0 ? stopNumber : "–"}</span>}
            <span className="min-w-0 flex-1">
              <span className="block break-words whitespace-normal text-xs font-bold text-foreground">{item.label}</span>
              <span className="block break-words whitespace-normal text-[11px] text-muted-foreground">{sublabel}</span>
              <TripWeatherItemMarker result={weatherResult} />
            </span>
            <input
              type="time"
              value={item.scheduled_time ?? ""}
              min={timeBounds.min}
              max={timeBounds.max}
              disabled={timeBounds.disabled}
              onChange={(event) => trip.schedule(item.id, item.scheduled_date, event.target.value || null)}
              aria-label={tCustomer("strictMigration.tripPlanner.timeFor", { item: item.label })}
              className="w-[86px] rounded-lg border border-border bg-background px-1.5 py-1 text-[11px] text-foreground"
            />
            {item.scheduled_date && <span className="sr-only">{tCustomer("strictMigration.tripPlanner.scheduledFor", { date: item.scheduled_date })}</span>}
            {(isLocation || isCustom) && (
              <button
                onClick={() => isLocation ? openStartEditor() : openStopEditor({ id: item.id, lat: item.lat, lng: item.lng, label: item.label, sublabel: item.sublabel, source: item.source, locationKind: item.kind })}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-primary"
                aria-label={tCustomer("strictMigration.tripPlanner.editItem", { item: item.label })}
              >
                <Pencil size={13} />
              </button>
            )}
            <button onClick={() => trip.remove(item.id)} className="rounded-lg p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={tCustomer("strictMigration.tripPlanner.removeItem", { item: item.label })}>
              <X size={14} />
            </button>
          </div>
        )}
      </li>
    );
  }

  function renderDaySection(title: string, date: string | null, items: TripItem[], emptyCopy: string, key?: string | number) {
    const dayTargetKey = date ? weatherPlan.dayTargetKeyByDate[date] : undefined;
    const dayTarget = dayTargetKey ? weatherTargetsByKey.get(dayTargetKey) : undefined;
    const dayWeatherResult = dayTargetKey ? weatherState.results[dayTargetKey] ?? null : null;
    const isSimulatedDay = Boolean(date && date === selectedDate && simulatedWeatherResult);
    const displayedWeatherResult = isSimulatedDay ? simulatedWeatherResult : dayWeatherResult;
    const simulationLabel = isSimulatedDay
      ? `${tCustomer("strictMigration.tripPlanner.weather.simulation.testData")} · ${tCustomer(`strictMigration.tripPlanner.weather.conditions.${simulatedWeatherConditionKeyForHour(overlayHour)}`)} · ${String(overlayHour).padStart(2, "0")}:00`
      : undefined;
    const timelineRows: ReactNode[] = [];
    const startAlreadyListed = items.some((item) => item.id === origin?.id);
    if (date === selectedDate && origin && !startAlreadyListed && items.length > 0) {
      timelineRows.push(
        <li key="trip-origin" className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-background/70 px-3 py-2 text-xs">
          <LocateFixed size={14} className="shrink-0 text-primary" />
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{tCustomer("strictMigration.tripPlanner.startingPoint")}</span>
          <span className="min-w-0 flex-1 break-words whitespace-normal font-semibold text-foreground">{origin.label}</span>
        </li>,
      );
      const firstRouteIndex = selectedRouteStops.findIndex((stop) => stop.id === items[0].id);
      if (firstRouteIndex === 1 && selectedRouteStops[0]?.id === origin.id) {
        timelineRows.push(renderTravelLeg(origin.id, items[0].id, 0));
      }
    }
    items.forEach((item, index) => {
      timelineRows.push(renderStopRow(item));
      const next = items[index + 1];
      if (!next) return;
      const fromRouteIndex = selectedRouteStops.findIndex((stop) => stop.id === item.id);
      const toRouteIndex = selectedRouteStops.findIndex((stop) => stop.id === next.id);
      if (fromRouteIndex >= 0 && toRouteIndex === fromRouteIndex + 1) {
        timelineRows.push(renderTravelLeg(item.id, next.id, fromRouteIndex));
      }
    });
    return (
      <section
        key={key ?? title}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => handleDropOnDay(date)}
        onClick={() => date && setSelectedDate(date)}
        data-trip-day={date ?? "unscheduled"}
        data-selected-day={date === selectedDate ? "true" : "false"}
        className={"rounded-2xl border p-3 transition " + (date === selectedDate ? "border-primary bg-secondary/70 shadow-[0_10px_28px_rgba(1,0,102,0.08)]" : "border-border bg-muted/35 hover:border-primary/30")}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-primary">{title}</h2>
            {date && <p className="mt-0.5 text-[11px] text-muted-foreground">{formatTripDay(date)}</p>}
            {date && (dayTarget || isSimulatedDay) && (
              <TripWeatherHint
                date={date}
                anchorLabel={isSimulatedDay ? tCustomer("strictMigration.tripPlanner.weather.simulation.label") : dayTarget!.label}
                result={displayedWeatherResult}
                loading={!isSimulatedDay && weatherState.status === "loading"}
                simulationLabel={simulationLabel}
                onSelectRiskHour={isSimulatedDay ? undefined : (hour) => handleSelectWeatherRiskHour(date, hour)}
              />
            )}
          </div>
          <span className="rounded-full bg-background px-2 py-1 text-[10px] font-bold text-muted-foreground">{tCustomer("ui.map.stopCount", { count: items.length })}</span>
        </div>
        {items.length > 0 ? <ul className="flex flex-col gap-2">{timelineRows}</ul> : <p className="rounded-xl border border-dashed border-border bg-background/70 px-3 py-3 text-center text-xs text-muted-foreground">{emptyCopy}</p>}
      </section>
    );
  }

  return (
    <section aria-label={tCustomer("strictMigration.tripPlanner.itinerary")} className="h-[calc(100dvh-6rem)] w-full overflow-hidden bg-card sm:h-[calc(100dvh-4rem)]">
          <div className="flex h-full w-full flex-col overflow-hidden bg-card">
            <div className="flex shrink-0 gap-1 border-b border-border bg-card p-2 xl:hidden" aria-label={tCustomer("strictMigration.tripPlanner.plannerViews")}>
              {(["ai", "itinerary", "places"] as const).map((panel) => (
                <button key={panel} onClick={() => setActivePanel(panel)} className={"flex-1 rounded-full px-3 py-2 text-xs font-bold capitalize " + (activePanel === panel ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted")}>
                  {panel === "ai" ? tCustomer("strictMigration.tripPlanner.ai.title") : panel === "itinerary" ? tCustomer("strictMigration.tripPlanner.itineraryTab") : tCustomer("strictMigration.tripPlanner.placesTab")}
                </button>
              ))}
            </div>

      <div style={plannerGridStyle} className="grid min-h-0 flex-1 grid-cols-1 transition-[grid-template-columns] duration-200 ease-out xl:grid-cols-[var(--planner-ai-width)_minmax(0,1fr)_var(--planner-places-width)]">
        <aside aria-label={tCustomer("strictMigration.tripPlanner.ai.title")} className={(activePanel === "ai" ? "flex" : "hidden") + " relative min-h-0 flex-col border-r border-border bg-card xl:flex"}>
          <button
            type="button"
            onClick={() => setAiCollapsed((collapsed) => !collapsed)}
            aria-expanded={!aiCollapsed}
            aria-label={tCustomer(aiCollapsed ? "strictMigration.tripPlanner.ai.expand" : "strictMigration.tripPlanner.ai.collapse")}
            title={tCustomer(aiCollapsed ? "strictMigration.tripPlanner.ai.expand" : "strictMigration.tripPlanner.ai.collapse")}
            className={aiCollapsed
              ? "hidden h-full w-full flex-col items-center gap-3 px-2 py-4 text-primary transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 xl:flex"
              : "absolute right-3 top-3 z-10 hidden h-8 w-8 place-items-center rounded-full border border-border bg-card text-primary transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 xl:grid"}
          >
            {aiCollapsed ? <><ChevronRight size={17} /><Sparkles size={16} /><span className="text-[10px] font-bold tracking-[0.12em] [writing-mode:vertical-rl]">{tCustomer("strictMigration.tripPlanner.ai.shortTitle")}</span></> : <ChevronLeft size={15} />}
          </button>
          {!aiCollapsed && <div role="separator" aria-label={tCustomer("strictMigration.tripPlanner.ai.resize")} aria-orientation="vertical" aria-valuemin={260} aria-valuemax={520} aria-valuenow={aiWidth} tabIndex={0} onPointerDown={handleAiResizeStart} onKeyDown={(event) => { if (event.key === "ArrowRight") setAiWidth((width) => Math.min(520, width + 20)); if (event.key === "ArrowLeft") setAiWidth((width) => Math.max(260, width - 20)); }} className="absolute -right-[3px] top-0 z-20 hidden h-full w-[6px] cursor-col-resize touch-none focus-visible:bg-primary/30 xl:block" />}
          <div className={(aiCollapsed ? "flex xl:hidden" : "flex") + " min-h-0 flex-1 flex-col"}>
            <header className="shrink-0 border-b border-border px-4 py-5">
              <div className="flex items-center gap-2 pr-10">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-secondary text-primary"><Sparkles size={16} /></span>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">{tCustomer("strictMigration.tripPlanner.ai.label")}</p><h1 className="text-lg font-bold text-foreground">{tCustomer("strictMigration.tripPlanner.ai.title")}</h1></div>
              </div>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <form onSubmit={requestAiPlan} className="space-y-2">
                <label htmlFor="trip-ai-preference" className="text-xs font-semibold text-foreground">{tCustomer("strictMigration.tripPlanner.ai.preferenceLabel")}</label>
                <input id="trip-ai-preference" value={aiPreference} onChange={(event) => setAiPreference(event.target.value)} maxLength={140} placeholder={tCustomer("strictMigration.tripPlanner.ai.preferencePlaceholder")} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10" />
                <button type="submit" disabled={aiLoading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-white transition hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60">
                  {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{aiLoading ? tCustomer("strictMigration.tripPlanner.ai.loading") : tCustomer("strictMigration.tripPlanner.ai.planAction")}
                </button>
              </form>
              {aiError && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{aiError}</p>}
              {aiSuggestions.length > 0 && <section aria-label={tCustomer("strictMigration.tripPlanner.ai.suggestions")} className="space-y-2">
                <h2 className="text-xs font-bold text-foreground">{tCustomer("strictMigration.tripPlanner.ai.suggestions")}</h2>
                {aiSuggestions.slice(0, 3).map((suggestion) => {
                  const added = trip.has(suggestion.productId);
                  return <article key={suggestion.productId} className="rounded-xl border border-border bg-background p-3">
                    <div className="flex gap-3">
                      {suggestion.image ? <Image src={suggestion.image} alt="" width={48} height={48} unoptimized className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><MapIcon size={16} /></span>}
                      <div className="min-w-0"><h3 className="text-xs font-bold text-foreground">{suggestion.productName}</h3><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{suggestion.message}</p><div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground"><Star size={10} fill="var(--highlight-yellow)" stroke="none" /><span>{suggestion.rating.toFixed(1)}</span><span>{formatMYR(suggestion.price)}</span></div></div>
                    </div>
                    <button type="button" onClick={() => addAiSuggestion(suggestion)} disabled={added} className="mt-2 w-full rounded-lg bg-secondary px-3 py-1.5 text-[11px] font-bold text-primary transition hover:bg-primary hover:text-white disabled:cursor-default disabled:opacity-60">{added ? tCustomer("ui.map.removeFromTrip") : tCustomer("strictMigration.tripPlanner.ai.addToDay")}</button>
                  </article>;
                })}
              </section>}
              {!aiLoading && !aiError && aiSuggestions.length === 0 && <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">{tCustomer("strictMigration.tripPlanner.ai.empty")}</p>}
              <details className="rounded-xl border border-border bg-background px-3 py-2">
                <summary className="cursor-pointer list-none text-xs font-semibold text-foreground">{tCustomer("strictMigration.tripPlanner.ai.budget")}</summary>
                <div className="pt-3"><TripBudgetGuard tripId={tripData.id} items={trip.items} activities={activities} onShowOnMap={(pin) => { setSuggestedPins((current) => current.some((existing) => existing.id === pin.id) ? current : [...current, pin]); focusPin(pin); setMapExpanded(true); setActivePanel("itinerary"); }} /></div>
              </details>
            </div>
          </div>
        </aside>

        <main aria-label={tCustomer("strictMigration.tripPlanner.itinerary")} className={(activePanel === "itinerary" ? "flex" : "hidden") + " relative min-h-0 flex-col bg-background xl:flex"}>
          <header className="flex shrink-0 flex-col items-stretch gap-2 border-b border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary">{tCustomer("strictMigration.tripPlanner.itineraryTab")}</p>
              <h2 className="mt-0.5 break-words whitespace-normal text-lg font-bold text-foreground">{selectedDay ? tCustomer("strictMigration.tripPlanner.dayNumber", { number: selectedDayIndex + 1 }) : tCustomer("strictMigration.tripPlanner.planDays")}</h2>
              <p className="text-xs text-muted-foreground">{selectedDay ? formatTripDay(selectedDay.date) : tCustomer("strictMigration.tripPlanner.planned", { scheduled: scheduledItemCount, total: trip.items.length })}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {selectedDay && <label className="sr-only" htmlFor="planner-selected-day">{tCustomer("strictMigration.tripPlanner.selectDay")}</label>}
              {selectedDay && <select id="planner-selected-day" value={selectedDay.date} onChange={(event) => setSelectedDate(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-2 text-xs font-semibold text-foreground outline-none focus:border-primary sm:max-w-52">{groupedItems.days.map((day, index) => <option key={day.date} value={day.date}>{tCustomer("strictMigration.tripPlanner.dayNumber", { number: index + 1 })} · {formatTripDay(day.date)}</option>)}</select>}
              <button type="button" onClick={() => setMapExpanded((expanded) => !expanded)} aria-expanded={mapExpanded} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground transition hover:border-primary/40"><MapIcon size={14} />{mapExpanded ? tCustomer("strictMigration.tripPlanner.ai.hideMap") : tCustomer("strictMigration.tripPlanner.ai.showMap")}</button>
              <button type="button" onClick={handleCheckout} disabled={checkingOut || scheduledItemCount === 0} aria-label={tCustomer("ui.tripCheckout.button", { count: scheduledItemCount })} title={tCustomer("ui.tripCheckout.button", { count: scheduledItemCount })} className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-white transition hover:bg-primary/90 disabled:opacity-40">{checkingOut ? <Loader2 size={15} className="animate-spin" /> : <ShoppingCart size={15} />}</button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-foreground">{tCustomer("strictMigration.tripPlanner.buildRoute")}</p>
              <button type="button" onClick={() => setShowAllVendors((value) => !value)} aria-pressed={showAllVendors} className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-primary">
                {showAllVendors ? <Eye size={13} className="text-primary" /> : <EyeOff size={13} />}
                {showAllVendors ? tCustomer("ui.map.showingAllVendors") : tCustomer("ui.map.showAllVendors")}
              </button>
            </div>

            {!locationStop && (
              <div className="mb-3 rounded-2xl border border-dashed border-primary/30 bg-secondary/60 p-3">
                <div className="flex items-center gap-2">
                  <LocateFixed size={16} className="shrink-0 text-primary" />
                  {editingStart ? <input autoFocus value={startInput} onChange={(event) => setStartInput(event.target.value)} placeholder={tCustomer("ui.map.typeLocation")} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary" /> : <span className="min-w-0 flex-1"><span className="block text-xs font-bold">{tCustomer("ui.map.addStartingPoint")}</span><span className="block text-[11px] text-muted-foreground">{tCustomer("ui.map.typePlaceOrGps")}</span></span>}
                  <button onClick={() => editingStart ? setEditingStart(false) : openStartEditor()} className="rounded-lg p-1 text-muted-foreground hover:bg-background" aria-label={tCustomer("ui.map.typeAddress")}>{editingStart ? <X size={14} /> : <Pencil size={14} />}</button>
                  <button onClick={useGps} disabled={locating} className="rounded-lg p-1 text-primary hover:bg-background disabled:opacity-50" aria-label={tCustomer("ui.map.useCurrentLocation")}>{locating ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />}</button>
                </div>
                {editingStart && locationSuggestions()}
                {locError && <p className="mt-1 text-xs text-destructive">{locError}</p>}
              </div>
            )}

            {mapExpanded && <div data-trip-route-map className="mb-4 h-44 overflow-hidden rounded-2xl border border-border bg-muted sm:h-48">
              <MapView pins={pins} center={center} zoom={near ? 12 : 7} height="100%" cluster radiusCenter={near && placeFilters.distanceKm !== null ? [near.lat, near.lng] : undefined} radiusKm={near ? placeFilters.distanceKm ?? undefined : undefined} onAddStop={toggleStop} stopIds={selectedRouteStops.map((stop) => stop.id)} suggestedIds={suggestedPins.map((pin) => pin.id)} routes={activeRoutes.map((route, index) => ({ path: route.geometry, selected: index === selectedRouteIdx, trafficSegments: route.traffic?.segments }))} fitCoordinates={selectedRouteCoordinates} disableNavigationGestures routeColor={MODE_STYLE[mode].color} routeDashed={MODE_STYLE[mode].dashed} focusRequest={focusRequest} onMapMovingChange={setMapMoving}>
                <TripWeatherMapOverlay result={displayedWeatherOverlay} status={displayedWeatherOverlayStatus} radarResult={radarState.result} radarStatus={radarState.status} mode={activeWeatherMapMode} liveRadarAvailable={liveRadarAvailable} enabled={weatherLayerEnabled} hour={overlayHour} onHourChange={setOverlayHour} onModeChange={setWeatherMapMode} onEnabledChange={setWeatherLayerEnabled} simulationAvailable={simulationAvailable} simulationEnabled={simulationActive} onSimulationEnabledChange={setSimulationEnabled} mapMoving={mapMoving} />
              </MapView>
            </div>}

            <div className="space-y-3">
              {selectedDay ? renderDaySection(tCustomer("strictMigration.tripPlanner.dayNumber", { number: selectedDayIndex + 1 }), selectedDay.date, selectedDay.items, tCustomer("strictMigration.tripPlanner.dropStopHint")) : renderDaySection(tCustomer("strictMigration.tripPlanner.planDays"), null, groupedItems.unscheduled, tCustomer("strictMigration.tripPlanner.addPlacesHint"))}
              {selectedDay && groupedItems.unscheduled.length > 0 && <details className="rounded-xl border border-border bg-card p-3"><summary className="cursor-pointer text-xs font-semibold text-foreground">{tCustomer("strictMigration.tripPlanner.unscheduled")} · {groupedItems.unscheduled.length}</summary><div className="mt-3">{renderDaySection(tCustomer("strictMigration.tripPlanner.unscheduled"), null, groupedItems.unscheduled, tCustomer("strictMigration.tripPlanner.allAssigned"))}</div></details>}
            </div>

            <div className="mt-3">
              {addingStop ? (
                <div className="rounded-2xl border border-border bg-muted p-3">
                  <div className="flex items-center gap-2">
                    <Search size={14} className="text-muted-foreground" />
                    <input autoFocus value={stopSearchInput} onChange={(event) => setStopSearchInput(event.target.value)} placeholder={tCustomer("ui.map.searchPlaceToAdd")} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary" />
                    <button onClick={() => { setAddingStop(false); setStopSearchInput(""); setStopSuggestions([]); }} className="rounded-lg p-1 text-muted-foreground hover:bg-background" aria-label={tCustomer("ui.actions.cancel")}><X size={14} /></button>
                  </div>
                  {stopSearchLoading && <p className="mt-2 text-xs text-muted-foreground">{tCustomer("ui.map.searching")}</p>}
                  {stopSuggestions.length > 0 && <ul className="mt-2 overflow-hidden rounded-lg border border-border bg-card">{stopSuggestions.map((suggestion, index) => <li key={suggestion.lat + "," + suggestion.lng + "," + index}><button onClick={() => chooseStopSuggestion(suggestion)} className="flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left text-xs last:border-0 hover:bg-muted"><LocateFixed size={13} className="mt-0.5 shrink-0 text-primary" /><span className="break-words whitespace-normal">{suggestion.label}</span></button></li>)}</ul>}
                </div>
              ) : <button onClick={() => setAddingStop(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs font-bold text-muted-foreground hover:border-primary hover:text-primary"><Plus size={14} /> {tCustomer("ui.map.addPlace")}</button>}
            </div>
          </div>

          <footer className="shrink-0 border-t border-border bg-card p-3 pb-20 xl:pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="planner-travel-mode">{tCustomer("strictMigration.tripPlanner.buildRoute")}</label>
              <select id="planner-travel-mode" value={mode} onChange={(event) => setMode(event.target.value as TravelModeId)} className="min-w-36 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground outline-none focus:border-primary">{TRAVEL_MODES.map((travelMode) => <option key={travelMode.id} value={travelMode.id}>{travelModeLabel(travelMode.id)}</option>)}</select>
              {hasRouteInputs && <p className="text-[11px] font-semibold text-muted-foreground">{mode === "TRANSIT" ? tCustomer("ui.map.transitOpensMaps") : routesLoading ? tCustomer("ui.map.calculatingRoute") : activeRoute ? `${formatDuration(activeRoute.durationMin)} · ${activeRoute.distanceKm} ${DISTANCE_UNIT_KM}` : tCustomer("ui.map.routeUnavailable")}</p>}
              {activeRoutes.length > 1 && <label className="ml-auto flex items-center gap-2 text-[11px] font-semibold text-muted-foreground"><span>{tCustomer("ui.map.routeOptions")}</span><select aria-label={tCustomer("ui.map.routeOptions")} value={selectedRouteIdx} onChange={(event) => setSelectedRouteIdx(Number(event.target.value))} className="max-w-52 rounded-lg border border-border bg-background px-2 py-2 text-[11px] text-foreground">{activeRoutes.map((route, index) => <option key={index} value={index}>{formatDurationShort(route.durationMin)} · {route.distanceKm} {DISTANCE_UNIT_KM}{route.hasTolls ? ` · ${tCustomer("ui.map.toll")}` : ""}</option>)}</select></label>}
            </div>
            {mode === "DRIVING" && activeRoute?.traffic && <details data-route-traffic-status className="mt-2 text-[10px] text-muted-foreground"><summary className="cursor-pointer font-semibold">{activeRoute.traffic.basis === "live" ? tCustomer("ui.map.trafficLive") : tCustomer("ui.map.trafficPredicted")}</summary><p className="pt-1">{tCustomer("ui.map.trafficProviderRetrievedAt", { time: new Date(activeRoute.traffic.retrievedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}</p></details>}
            <button onClick={() => directionsUrl && window.open(directionsUrl, "_blank")} disabled={!directionsUrl} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40"><Navigation size={14} /> {tCustomer("ui.map.getDirectionsGoogle")}</button>
            <div className="mt-2 flex items-center justify-between"><button onClick={() => setUrlPreview((current) => current ? null : directionsUrl)} className="text-[10px] font-bold text-muted-foreground hover:text-foreground">{urlPreview ? tCustomer("ui.map.hideHandoffUrl") : tCustomer("ui.map.showHandoffUrl")}</button><button onClick={trip.clear} className="text-[10px] font-bold text-muted-foreground hover:text-destructive">{tCustomer("ui.map.clearTrip")}</button></div>
            {trip.stops.length > 9 && <p className="mt-1 text-[10px] font-semibold text-destructive">{tCustomer("ui.map.maxStops")}</p>}
            {urlPreview && <code className="mt-2 block max-h-16 overflow-auto break-all rounded-lg bg-muted p-2 text-[10px]">{urlPreview}</code>}
          </footer>
        </main>

        <aside aria-label={tCustomer("strictMigration.tripPlanner.placesToAdd")} className={(activePanel === "places" ? "flex" : "hidden") + " relative min-h-0 flex-col border-l border-border bg-card xl:flex"}>
          <button
            type="button"
            onClick={() => setPlacesCollapsed((collapsed) => !collapsed)}
            aria-expanded={!placesCollapsed}
            aria-label={tCustomer(placesCollapsed ? "ui.map.expandPlacesPanel" : "ui.map.minimizePlacesPanel")}
            title={tCustomer(placesCollapsed ? "ui.map.expandPlacesPanel" : "ui.map.minimizePlacesPanel")}
            className={placesCollapsed
              ? "hidden h-full w-full flex-col items-center gap-3 px-2 py-4 text-primary transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 xl:flex"
              : "absolute right-3 top-4 z-10 hidden h-8 w-8 place-items-center rounded-full border border-border bg-card text-primary transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 xl:grid"}
          >
            {placesCollapsed ? (
              <>
              <ChevronLeft size={17} />
              <Plus size={16} />
              <span className="text-[10px] font-bold tracking-[0.12em] [writing-mode:vertical-rl]">{tCustomer("ui.map.addPlace")}</span>
              </>
            ) : <ChevronRight size={15} />}
          </button>
          <div className={(placesCollapsed ? "flex xl:hidden" : "flex") + " min-h-0 flex-1 flex-col"}>
          {filtersOpen ? (
            <TripPlaceFilterPanel
              filters={placeFilters}
              hasOrigin={Boolean(near)}
              resultCount={filteredActivities.length}
              onChange={patchPlaceFilters}
              onClear={clearPlaceFilters}
              onDone={() => setFiltersOpen(false)}
            />
          ) : <>
          <header className="shrink-0 border-b border-border px-4 py-4">
            <p className="pr-10 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">{tCustomer("ui.map.nearbyToAdd")}</p>
            <div className="mt-1 flex items-end justify-between gap-2"><div><h2 className="text-lg font-bold text-foreground">{tCustomer("ui.map.addPlace")}</h2><p className="mt-1 text-xs text-muted-foreground">{tCustomer("strictMigration.tripPlanner.placesReady", { count: filteredActivities.length })}</p></div><button type="button" onClick={() => setShowAllVendors((value) => !value)} aria-pressed={showAllVendors} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-primary" title={tCustomer("strictMigration.tripPlanner.toggleVendorPins")}>{showAllVendors ? <Eye size={16} /> : <EyeOff size={16} />}</button></div>
            <label className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 focus-within:border-primary"><Search size={15} className="text-muted-foreground" /><span className="sr-only">{tCustomer("ui.map.searchExperience")}</span><input value={placeFilters.query} onChange={(event) => patchPlaceFilters({ query: event.target.value })} placeholder={tCustomer("ui.map.searchExperience")} className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><label className="sr-only" htmlFor="planner-category">{tCustomer("ui.recommendations.category")}</label><select id="planner-category" value={placeFilters.category ?? ""} onChange={(event) => patchPlaceFilters({ category: event.target.value || null })} className="rounded-lg border border-border bg-background px-2 py-2 text-xs font-semibold outline-none focus:border-primary"><option value="">{tCustomer("ui.map.allCategories")}</option>{CATEGORIES.map((entry) => <option key={entry.id} value={entry.id}>{tCustomer(entry.labelKey)}</option>)}</select><button type="button" onClick={() => setFiltersOpen(true)} aria-expanded={filtersOpen} aria-label={tCustomer("strictMigration.tripPlanner.filters.moreFilters")} className="relative grid h-9 w-9 place-items-center rounded-full border border-border bg-background text-primary transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><SlidersHorizontal size={15} />{activePlaceFilterCount > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">{activePlaceFilterCount}</span>}</button></div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <ul className="flex flex-col gap-2">
              {visibleActivitiesPage.map((activity) => {
                const added = trip.has(activity.id);
                const sponsoredClick = () => activity.sponsorship && recordSponsoredEvent(activity.sponsorship.placementId, "click", activity.id);
                return <li key={activity.id} data-activity-card={activity.id} data-promoted-activity={activity.sponsorship ? activity.sponsorship.placementId : undefined} draggable={!added} onDragStart={() => setDragPayload({ kind: "catalogue", activityId: activity.id })} onDragEnd={() => setDragPayload(null)} className={"rounded-2xl border p-2.5 transition " + (added ? "border-[#16A34A]/40 bg-[#16A34A]/5" : "cursor-grab border-border hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg active:cursor-grabbing")}><div className="flex gap-2.5"><button type="button" onClick={() => { sponsoredClick(); focusPin({ id: activity.id, lat: activity.outlet.lat, lng: activity.outlet.lng, label: activity.name, sublabel: formatMYR(Number(activity.price)) + " · " + activity.outlet.city, href: "/customer/activity/" + activity.id, imageUrl: activity.image }); }} className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-secondary" aria-label={tCustomer("strictMigration.tripPlanner.showOnMap", { item: activity.name })}>{activity.image ? <Image src={activity.image} alt="" width={56} height={56} unoptimized className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-muted-foreground"><ImageOff size={17} /></span>}</button><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><h3 className="min-w-0 flex-1 break-words whitespace-normal text-xs font-bold text-foreground">{activity.name}</h3>{activity.sponsorship && <span className="shrink-0 rounded-full bg-highlight-yellow/20 px-1.5 py-0.5 text-[9px] font-bold text-foreground">{tCustomer("strictMigration.tripPlanner.filters.promoted")}</span>}</div><p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><Star size={10} fill="var(--highlight-yellow)" stroke="none" /> {activity.rating} · {near && activity.distanceKm !== undefined ? tCustomer("ui.map.distanceKm", { distance: activity.distanceKm.toFixed(1) }) : activity.outlet.city} · {formatMYR(Number(activity.price))}</p><div className="mt-2 flex flex-wrap items-center gap-2"><button onClick={() => { sponsoredClick(); toggleStop({ id: activity.id, lat: activity.outlet.lat, lng: activity.outlet.lng, label: activity.name, sublabel: formatMYR(Number(activity.price)) + " · " + activity.outlet.city }); }} className={"rounded-lg px-2.5 py-1 text-[11px] font-bold " + (added ? "bg-[#16A34A] text-white" : "bg-primary text-white")}>{added ? tCustomer("ui.map.removeFromTrip") : tCustomer("ui.actions.addToTrip")}</button>{!added && groupedItems.days.length > 0 && <select aria-label={tCustomer("strictMigration.tripPlanner.chooseDay", { item: activity.name })} defaultValue="" onChange={(event) => { if (event.target.value) { sponsoredClick(); chooseDayForActivity(activity, event.target.value); } event.currentTarget.value = ""; }} className="max-w-[96px] rounded-lg border border-border bg-background px-1.5 py-1 text-[10px] font-bold text-primary"><option value="" disabled>{tCustomer("strictMigration.tripPlanner.chooseDayShort")}</option>{groupedItems.days.map((day, index) => <option key={day.date} value={day.date}>{tCustomer("strictMigration.tripPlanner.dayNumber", { number: index + 1 })}</option>)}</select>}<a href={"/customer/activity/" + activity.id} onClick={sponsoredClick} className="text-[11px] font-semibold text-muted-foreground hover:text-primary">{tCustomer("ui.actions.viewDetails")}</a></div></div></div></li>;
              })}
            </ul>
            {filteredActivities.length === 0 && <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center"><Search size={22} className="mx-auto mb-2 text-muted-foreground" /><p className="text-xs font-bold text-foreground">{tCustomer("ui.map.noPlacesRadius")}</p><p className="mt-1 text-[11px] text-muted-foreground">{tCustomer("ui.map.noPlacesRadius")}</p></div>}
          </div>
          <DirectoryPagination
            ariaLabel={tCustomer("strictMigration.tripPlanner.placePagination")}
            currentPage={safePlacesPage}
            itemLabel={tCustomer("strictMigration.tripPlanner.placeItemLabel")}
            onPageChange={setPlacesPage}
            pageSize={PLACES_PAGE_SIZE}
            totalItems={filteredActivities.length}
            totalPages={placesTotalPages}
            variant="compact"
          />
          </>}
          </div>
        </aside>
            </div>
          </div>
    </section>
  );
}
