"use client";

import { useRef, useState } from "react";
import { Ban, CalendarDays, Clock, MapPin, Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { MapView } from "@/components/map/map-view";
import { useAppDialog } from "@/components/providers/app-dialog";
import { useActionFeedback } from "@/components/providers/action-feedback";
import { LocationSearch, type PlaceHit } from "./location-search";
import { DEFAULT_LOCALE, isAppLocale } from "@/lib/i18n/locale";
import { formatEventDateRange, formatEventHours } from "@/lib/promotion-campaigns/locations";

export type EditableLocation = {
  /** null until the location exists in the database (create-event flow). */
  id: string | null;
  key: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  startsOn: string;
  endsOn: string;
  opensAt: string;
  closesAt: string;
  /** Cancelled locations stay listed but can no longer be edited. */
  status?: "active" | "cancelled";
};

export type LocationDefaults = Pick<EditableLocation, "startsOn" | "endsOn" | "opensAt" | "closesAt">;

type Props = {
  /** null = the event isn't saved yet; edits stay local and are saved on publish. */
  campaignId: string | null;
  locations: EditableLocation[];
  defaults: LocationDefaults;
  onLocalChange?: (next: EditableLocation[]) => void;
  onSaved?: () => void | Promise<void>;
  disabled?: boolean;
};

const KUALA_LUMPUR: [number, number] = [3.139, 101.6869];
const inputClass = "mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal text-foreground";

export function toLocationPayload(location: EditableLocation) {
  return {
    name: location.name.trim(),
    address: location.address.trim() || null,
    lat: location.lat,
    lng: location.lng,
    startsOn: location.startsOn,
    endsOn: location.endsOn,
    opensAt: location.opensAt,
    closesAt: location.closesAt,
  };
}

function isValid(location: EditableLocation) {
  return location.name.trim().length >= 2
    && Boolean(location.startsOn && location.endsOn && location.opensAt && location.closesAt)
    && location.endsOn >= location.startsOn
    && location.closesAt > location.opensAt;
}

export function EventLocationsEditor({ campaignId, locations, defaults, onLocalChange, onSaved, disabled = false }: Props) {
  const { t, i18n } = useTranslation("admin");
  const { confirm, prompt } = useAppDialog();
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  const [draft, setDraft] = useState<EditableLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const reverseRequest = useRef(0);
  const { showFeedback } = useActionFeedback();

  function openDraft(location: EditableLocation) {
    setError(null);
    setSearchText(location.address);
    setDraft(location);
  }

  function startAdd() {
    openDraft({ id: null, key: `new-${Date.now()}`, name: "", address: "", lat: null, lng: null, ...defaults });
  }

  /** A search result drops the pin there and fills an empty address. */
  function choosePlace(hit: PlaceHit) {
    setSearchText(hit.label);
    setDraft((current) => (current ? { ...current, lat: hit.lat, lng: hit.lng, address: current.address.trim() ? current.address : hit.label } : current));
  }

  /** Dragging the pin shows the place under it in the search box. */
  async function dragPin(lat: number, lng: number) {
    update({ lat, lng });
    const id = ++reverseRequest.current;
    try {
      const response = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`);
      const body = await response.json() as { data?: { results?: PlaceHit[] } };
      const label = body.data?.results?.[0]?.label;
      if (label && id === reverseRequest.current) {
        setSearchText(label);
        setDraft((current) => (current && !current.address.trim() ? { ...current, address: label } : current));
      }
    } catch {
      // Keep the pin; the name is only a convenience.
    }
  }

  async function saveDraft() {
    if (!draft) return;
    if (!isValid(draft)) { setError(t("promotionCampaigns.locations.invalid")); return; }
    setError(null);
    if (!campaignId) {
      const exists = locations.some((location) => location.key === draft.key);
      onLocalChange?.(exists ? locations.map((location) => (location.key === draft.key ? draft : location)) : [...locations, draft]);
      setDraft(null);
      return;
    }
    setBusy(true);
    try {
      const url = draft.id
        ? `/api/admin/promotion-campaigns/${campaignId}/locations/${draft.id}`
        : `/api/admin/promotion-campaigns/${campaignId}/locations`;
      const response = await fetch(url, {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toLocationPayload(draft)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || t("promotionCampaigns.locations.saveError"));
      setDraft(null);
      await onSaved?.();
      showFeedback("success", t("promotionCampaigns.locations.changesSaved"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("promotionCampaigns.locations.saveError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(location: EditableLocation) {
    if (!await confirm(t("promotionCampaigns.locations.confirmRemove"))) return;
    setError(null);
    if (!campaignId || !location.id) {
      onLocalChange?.(locations.filter((entry) => entry.key !== location.key));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/promotion-campaigns/${campaignId}/locations/${location.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || t("promotionCampaigns.locations.saveError"));
      await onSaved?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("promotionCampaigns.locations.saveError"));
    } finally {
      setBusy(false);
    }
  }

  async function cancelLocation(location: EditableLocation) {
    if (!campaignId || !location.id) return;
    const reason = await prompt(t("promotionCampaigns.locations.cancelPrompt", { name: location.name }));
    if (reason === null) return;
    if (reason.trim().length < 5) { setError(t("promotionCampaigns.locations.cancelReasonRequired")); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/promotion-campaigns/${campaignId}/locations/${location.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || t("promotionCampaigns.locations.cancelError"));
      await onSaved?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("promotionCampaigns.locations.cancelError"));
    } finally {
      setBusy(false);
    }
  }

  const update = (patch: Partial<EditableLocation>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const pin: [number, number] | null = draft && draft.lat !== null && draft.lng !== null ? [draft.lat, draft.lng] : null;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{t("promotionCampaigns.locations.title")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("promotionCampaigns.locations.description")}</p>
      </div>

      {locations.length === 0 && !draft && (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">{t("promotionCampaigns.locations.empty")}</p>
      )}

      {locations.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {locations.map((location) => (
            <li key={location.key} className="flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0 text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-foreground">
                  <MapPin size={14} className="text-primary" aria-hidden="true" />{location.name}
                  {location.status === "cancelled" && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-bold text-destructive">{t("promotionCampaigns.locations.cancelled")}</span>}
                </p>
                <p className="mt-0.5 break-words pl-5 text-xs text-muted-foreground">{location.address || t("promotionCampaigns.locations.addressTba")}</p>
                <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 pl-5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><CalendarDays size={12} aria-hidden="true" />{formatEventDateRange(location.startsOn, location.endsOn, locale)}</span>
                  <span className="flex items-center gap-1"><Clock size={12} aria-hidden="true" />{formatEventHours(location.opensAt, location.closesAt, locale)}</span>
                </p>
              </div>
              {!disabled && location.status !== "cancelled" && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => openDraft(location)}>
                    <Pencil size={13} aria-hidden="true" /> {t("promotionCampaigns.locations.edit")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void remove(location)}>
                    <Trash2 size={13} aria-hidden="true" /> {t("promotionCampaigns.locations.remove")}
                  </Button>
                  {campaignId && location.id && (
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void cancelLocation(location)} className="text-destructive">
                      <Ban size={13} aria-hidden="true" /> {t("promotionCampaigns.locations.cancelLocation")}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/[0.03] p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold text-muted-foreground">{t("promotionCampaigns.locations.name")}
              <input value={draft.name} maxLength={120} onChange={(event) => update({ name: event.target.value })} className={inputClass} />
            </label>
            <label className="text-xs font-semibold text-muted-foreground">{t("promotionCampaigns.locations.address")}
              <input value={draft.address} maxLength={300} onChange={(event) => update({ address: event.target.value })} className={inputClass} />
            </label>
            <label className="text-xs font-semibold text-muted-foreground">{t("promotionCampaigns.locations.startsOn")}
              <input type="date" value={draft.startsOn} onChange={(event) => update({ startsOn: event.target.value })} className={inputClass} />
            </label>
            <label className="text-xs font-semibold text-muted-foreground">{t("promotionCampaigns.locations.endsOn")}
              <input type="date" value={draft.endsOn} min={draft.startsOn || undefined} onChange={(event) => update({ endsOn: event.target.value })} className={inputClass} />
            </label>
            <label className="text-xs font-semibold text-muted-foreground">{t("promotionCampaigns.locations.opensAt")}
              <input type="time" value={draft.opensAt} onChange={(event) => update({ opensAt: event.target.value })} className={inputClass} />
            </label>
            <label className="text-xs font-semibold text-muted-foreground">{t("promotionCampaigns.locations.closesAt")}
              <input type="time" value={draft.closesAt} min={draft.opensAt || undefined} onChange={(event) => update({ closesAt: event.target.value })} className={inputClass} />
            </label>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{t("promotionCampaigns.locations.pin")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {/* "lng" would be read by i18next as a language override, so the placeholders are latitude/longitude. */}
              {pin ? t("promotionCampaigns.locations.pinSet", { latitude: pin[0].toFixed(5), longitude: pin[1].toFixed(5) }) : t("promotionCampaigns.locations.pinHint")}
            </p>
            <div className="mt-2">
              <LocationSearch value={searchText} onChange={setSearchText} onSelect={choosePlace} />
            </div>
            <div className="mt-2 h-[26rem] overflow-hidden rounded-xl">
              <MapView
                pins={[]}
                center={pin ?? KUALA_LUMPUR}
                zoom={pin ? 16 : 11}
                height={416}
                userLocation={pin ?? KUALA_LUMPUR}
                onUserLocationDrag={(lat, lng) => void dragPin(lat, lng)}
                markerStyle="pin"
              />
            </div>
            {pin && (
              <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => update({ lat: null, lng: null })}>
                <X size={13} aria-hidden="true" /> {t("promotionCampaigns.locations.clearPin")}
              </Button>
            )}
          </div>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void saveDraft()}>{t("promotionCampaigns.locations.save")}</Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setDraft(null); setError(null); }}>{t("promotionCampaigns.locations.cancel")}</Button>
          </div>
        </div>
      ) : (
        <>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          {!disabled && (
            <Button type="button" variant="outline" size="sm" onClick={startAdd}>
              <Plus size={14} aria-hidden="true" /> {t("promotionCampaigns.locations.add")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
