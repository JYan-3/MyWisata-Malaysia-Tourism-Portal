"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useActionFeedback } from "@/components/providers/action-feedback";
import { ImageShapeHint, useImageCrop } from "@/components/shared/image-crop-dialog";
import type { HotelProfile } from "@/lib/validation/vendor-schemas";

type AmenityOption = { code: string; label_en: string; label_ms: string; label_zh: string; icon: string };
export type HotelProfileFormData = {
  isHotel: boolean;
  live: HotelProfile;
  pending: HotelProfile | null;
  lastRejection: { note: string | null; reviewedAt: string | null } | null;
  amenities: AmenityOption[];
};

/** Presentational form: edits a copy of the pending profile (or the live one) and submits it for review. */
export function HotelProfileForm({ data, saving, uploading, onSubmit, onUpload }: {
  data: HotelProfileFormData;
  saving: boolean;
  uploading: boolean;
  onSubmit(profile: HotelProfile): void;
  onUpload(file: File, add: (url: string) => void): void;
}) {
  const { t, i18n } = useTranslation("vendor");
  const [profile, setProfile] = useState<HotelProfile>(data.pending ?? data.live);
  const language = i18n.resolvedLanguage ?? i18n.language;
  const label = (amenity: AmenityOption) => (language === "ms" ? amenity.label_ms : language === "zh-CN" ? amenity.label_zh : amenity.label_en);
  const update = (patch: Partial<HotelProfile>) => setProfile((current) => ({ ...current, ...patch }));
  const { cropToShape, cropDialog } = useImageCrop();
  const toggleAmenity = (code: string, on: boolean) => update({ amenityCodes: on ? [...profile.amenityCodes, code] : profile.amenityCodes.filter((item) => item !== code) });
  const movePhoto = (index: number) => update({ photos: profile.photos.map((url, i) => (i === index - 1 ? profile.photos[index] : i === index ? profile.photos[index - 1] : url)) });
  const status = data.pending
    ? t("hotelProfile.status.pending")
    : data.lastRejection
      ? t("hotelProfile.status.rejected", { note: data.lastRejection.note ?? "" })
      : t("hotelProfile.status.live");

  return (
    <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); onSubmit(profile); }}>
      <p role="status" className={`rounded-xl px-4 py-3 text-sm ${data.lastRejection && !data.pending ? "bg-destructive/10 text-destructive" : "bg-secondary text-secondary-foreground"}`}>{status}</p>

      <label className="block text-sm font-medium text-foreground">
        {t("hotelProfile.fields.about")}
        <Textarea className="mt-1.5" rows={5} maxLength={2000} value={profile.about} onChange={(event) => update({ about: event.target.value })} />
      </label>

      <fieldset>
        <legend className="text-sm font-medium text-foreground">{t("hotelProfile.fields.amenities")}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.amenities.map((amenity) => (
            <label key={amenity.code} className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={profile.amenityCodes.includes(amenity.code)} onCheckedChange={(checked) => toggleAmenity(amenity.code, checked === true)} />
              {label(amenity)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-foreground">
          {t("hotelProfile.fields.checkIn")}
          <Input type="time" className="mt-1.5" value={profile.checkInTime} onChange={(event) => update({ checkInTime: event.target.value })} required />
        </label>
        <label className="block text-sm font-medium text-foreground">
          {t("hotelProfile.fields.checkOut")}
          <Input type="time" className="mt-1.5" value={profile.checkOutTime} onChange={(event) => update({ checkOutTime: event.target.value })} required />
        </label>
      </div>

      <label className="block text-sm font-medium text-foreground">
        {t("hotelProfile.fields.policies")}
        <Textarea className="mt-1.5" rows={4} maxLength={2000} value={profile.policies} onChange={(event) => update({ policies: event.target.value })} />
      </label>

      <div>
        <p className="text-sm font-medium text-foreground">{t("hotelProfile.fields.photos")}</p>
        <p className="text-xs text-muted-foreground">{t("hotelProfile.photoHint")}</p>
        <ImageShapeHint shape="photo" className="text-xs text-muted-foreground" />
        <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {profile.photos.map((url, index) => (
            <li key={url} className="overflow-hidden rounded-xl border border-border bg-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={t("hotelProfile.photoAlt", { index: index + 1 })} className="aspect-[4/3] w-full object-cover" />
              <div className="flex justify-between p-1.5">
                <Button type="button" size="icon" variant="ghost" disabled={index === 0} aria-label={t("hotelProfile.movePhotoUp")} onClick={() => movePhoto(index)}><ArrowUp size={14} /></Button>
                <Button type="button" size="icon" variant="ghost" aria-label={t("hotelProfile.removePhoto")} onClick={() => update({ photos: profile.photos.filter((item) => item !== url) })}><Trash2 size={14} /></Button>
              </div>
            </li>
          ))}
        </ul>
        <label className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary">
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
          {t("hotelProfile.addPhoto")}
          <Input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading || profile.photos.length >= 20}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void cropToShape(file, "photo").then((cropped) => { if (cropped) onUpload(cropped, (url) => update({ photos: [...profile.photos, url] })); });
            }} />
        </label>
        {cropDialog}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>{saving ? t("hotelProfile.submitting") : t("hotelProfile.submit")}</Button>
      </div>
    </form>
  );
}

/**
 * Hotel vendors edit a fixed hotel profile instead of the widget page builder (D3).
 * Outlets that do not sell rooms render `children` (the existing builder) unchanged.
 */
export function HotelProfileEditor({ vendorId, outletId, outletName, onClose, children }: { vendorId: string; outletId: string; outletName: string; onClose(): void; children: ReactNode }) {
  const { t } = useTranslation("vendor");
  const { showFeedback } = useActionFeedback();
  const [state, setState] = useState<"loading" | "hotel" | "notHotel">("loading");
  const [data, setData] = useState<HotelProfileFormData | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const endpoint = `/api/vendors/${vendorId}/outlets/${outletId}/hotel-profile`;

  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (response.status === 409) { setState("notHotel"); return; }
    const body = (await response.json()) as { data?: HotelProfileFormData };
    setData(body.data ?? null);
    setState("hotel");
  }, [endpoint]);

  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);

  async function submit(profile: HotelProfile) {
    setSaving(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? t("hotelProfile.errors.submit"));
      showFeedback("success", t("hotelProfile.submitted"));
      await load();
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : t("hotelProfile.errors.submit"));
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File, add: (url: string) => void) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${endpoint}/photos`, { method: "POST", body: form });
      const body = (await response.json()) as { data?: { url?: string }; error?: { message?: string } };
      if (!response.ok || !body.data?.url) throw new Error(body.error?.message ?? t("hotelProfile.errors.upload"));
      add(body.data.url);
    } catch (error) {
      showFeedback("error", error instanceof Error ? error.message : t("hotelProfile.errors.upload"));
    } finally {
      setUploading(false);
    }
  }

  if (state === "notHotel") return <>{children}</>;
  return (
    <section className="mx-auto max-w-4xl rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{t("hotelProfile.eyebrow")}</p>
          <h1 className="mt-1 text-xl font-bold text-foreground">{outletName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("hotelProfile.description")}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label={t("hotelProfile.close")} onClick={onClose}><X size={18} /></Button>
      </div>
      {state === "loading" || !data
        ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" />{t("hotelProfile.loading")}</p>
        : <HotelProfileForm key={JSON.stringify(data.pending ?? data.live)} data={data} saving={saving} uploading={uploading} onSubmit={(profile) => void submit(profile)} onUpload={(file, add) => void upload(file, add)} />}
    </section>
  );
}
