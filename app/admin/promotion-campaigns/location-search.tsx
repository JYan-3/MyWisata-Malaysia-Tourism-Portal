"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDebounce } from "@/hooks/use-debounce";

export type PlaceHit = { label: string; lat: number; lng: number };

type Props = {
  /** Shown in the box: what the admin typed, or the place under the pin. */
  value: string;
  onChange: (value: string) => void;
  onSelect: (hit: PlaceHit) => void;
};

/** Search for a place in Malaysia and drop the location pin on it (uses /api/geocode). */
export function LocationSearch({ value, onChange, onSelect }: Props) {
  const { t } = useTranslation("admin");
  const [results, setResults] = useState<PlaceHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const typed = useRef(false);
  const requestId = useRef(0);
  const query = useDebounce(value, 350);

  useEffect(() => {
    // Only search what the admin typed, not names filled in from the pin.
    if (!typed.current || query.trim().length < 3) return;
    const id = ++requestId.current;
    (async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`);
        const body = await response.json() as { data?: { results?: PlaceHit[] } };
        if (id === requestId.current) {
          setResults(body.data?.results ?? []);
          setOpen(true);
        }
      } catch {
        if (id === requestId.current) setResults([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    })();
  }, [query]);

  function choose(hit: PlaceHit) {
    typed.current = false;
    requestId.current += 1;
    setOpen(false);
    setResults([]);
    onSelect(hit);
  }

  return (
    <div className="relative">
      <label className="relative block">
        <span className="sr-only">{t("promotionCampaigns.locations.search")}</span>
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          value={value}
          onChange={(event) => {
            typed.current = true;
            onChange(event.target.value);
          }}
          onFocus={() => { if (results.length) setOpen(true); }}
          onBlur={() => setOpen(false)}
          placeholder={t("promotionCampaigns.locations.searchPlaceholder")}
          className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm text-foreground"
        />
        {loading && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />}
      </label>
      {open && (
        <ul
          role="listbox"
          onMouseDown={(event) => event.preventDefault()}
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">{t("promotionCampaigns.locations.searchEmpty")}</li>
          ) : results.map((hit) => (
            <li key={`${hit.lat},${hit.lng},${hit.label}`}>
              <button type="button" role="option" aria-selected={false} onClick={() => choose(hit)} className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-secondary">
                <MapPin size={14} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
                <span className="min-w-0">{hit.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
