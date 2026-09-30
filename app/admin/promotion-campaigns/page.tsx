"use client";

import { useCallback, useEffect, useState } from "react";
import { useActionFeedback } from "@/components/providers/action-feedback";
import { CalendarClock, ImagePlus, Loader2, MapPin, Megaphone, RefreshCw, Save, Send, ShieldCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AdminPageHeader, AdminPageShell } from "@/components/admin/admin-page-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAppDialog } from "@/components/providers/app-dialog";
import { formatDateTime } from "@/lib/i18n/format";
import { DEFAULT_LOCALE, isAppLocale } from "@/lib/i18n/locale";
import { getMalaysiaDateTimeRangeDefaults } from "@/lib/datetime/date-input";
import { isInvalidDateTimeRange, malaysiaDateTimeLocalToIso } from "@/lib/datetime/malaysia";
import type { PromotionCampaignStatus } from "@/lib/promotion-campaigns/types";
import { EventLocationsEditor, toLocationPayload, type EditableLocation, type LocationDefaults } from "./event-locations-editor";

type LocationRow = {
  id: string; name: string; address: string | null; lat: number | null; lng: number | null;
  starts_on: string; ends_on: string; opens_at: string; closes_at: string; status?: string;
};
type CampaignRow = {
  id: string; slug: string; title: string; summary: string; description: string;
  poster_url: string | null; operating_hours: string | null;
  status: PromotionCampaignStatus; starts_at: string; ends_at: string;
  created_by: string; updated_at: string; rejection_note: string | null;
  locations?: LocationRow[];
};

function toEditableLocations(rows: LocationRow[] | undefined): EditableLocation[] {
  return [...(rows ?? [])]
    .sort((left, right) => left.starts_on.localeCompare(right.starts_on))
    .map((row) => ({
      id: row.id, key: row.id, name: row.name, address: row.address ?? "", lat: row.lat, lng: row.lng,
      startsOn: row.starts_on, endsOn: row.ends_on, opensAt: row.opens_at.slice(0, 5), closesAt: row.closes_at.slice(0, 5),
      status: row.status === "cancelled" ? "cancelled" as const : "active" as const,
    }));
}
type DraftForm = {
  title: string; slug: string; summary: string; description: string;
  startsAt: string; endsAt: string; posterUrl: string | null; operatingHours: string;
};

function malaysiaLocalDateTime(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}

function initialForm(): DraftForm {
  const defaults = getMalaysiaDateTimeRangeDefaults();
  return { title: "", slug: "", summary: "", description: "", startsAt: defaults.from, endsAt: defaults.to, posterUrl: null, operatingHours: "" };
}

function formatTimeOfDay(hhmm: string): string {
  const [hour, minute] = hhmm.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(2000, 0, 1, hour, minute));
}

function composeOperatingHours(from: string, to: string): string {
  if (!from || !to) return "";
  return `${formatTimeOfDay(from)} – ${formatTimeOfDay(to)} daily`;
}

function parseOperatingHours(text: string): { from: string; to: string } | null {
  const match = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;
  const to24 = (hourText: string, minuteText: string, meridiem: string) => {
    let hour = Number(hourText) % 12;
    if (meridiem.toUpperCase() === "PM") hour += 12;
    return `${String(hour).padStart(2, "0")}:${minuteText}`;
  };
  return { from: to24(match[1], match[2], match[3]), to: to24(match[4], match[5], match[6]) };
}

function actionForStatus(status: PromotionCampaignStatus) {
  if (status === "draft" || status === "rejected") return ["submit"] as const;
  if (status === "pending_approval") return ["approve", "reject"] as const;
  if (status === "approved") return ["pause", "archive"] as const;
  if (status === "paused") return ["resume", "archive"] as const;
  return [] as const;
}

export default function PromotionCampaignsPage() {
  const { t, i18n } = useTranslation("admin");
  const { confirm, prompt } = useAppDialog();
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [form, setForm] = useState<DraftForm>(initialForm);
  const [editing, setEditing] = useState<CampaignRow | null>(null);
  const { showFeedback } = useActionFeedback();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hoursFrom, setHoursFrom] = useState("");
  const [hoursTo, setHoursTo] = useState("");
  const [formLocations, setFormLocations] = useState<EditableLocation[]>([]);
  const [openLocationsFor, setOpenLocationsFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/promotion-campaigns", { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 403 || response.status === 401) {
        setForbidden(true);
        return;
      }
      if (!response.ok) throw new Error(payload.error?.message || t("promotionCampaigns.errors.load"));
      setCampaigns(payload.data?.campaigns ?? []);
      setForbidden(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("promotionCampaigns.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    await load();
  }, [load]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  function resetForm() {
    setForm(initialForm());
    setEditing(null);
    setHoursFrom("");
    setHoursTo("");
    setFormLocations([]);
  }

  // New locations start on the event's dates and default hours; the admin adjusts per stop.
  function locationDefaultsFor(startsAt: string, endsAt: string): LocationDefaults {
    return { startsOn: startsAt.slice(0, 10), endsOn: endsAt.slice(0, 10), opensAt: hoursFrom || "10:00", closesAt: hoursTo || "22:00" };
  }

  function editCampaign(campaign: CampaignRow) {
    setEditing(campaign);
    setForm({
      title: campaign.title,
      slug: campaign.slug,
      summary: campaign.summary,
      description: campaign.description,
      startsAt: malaysiaLocalDateTime(campaign.starts_at),
      endsAt: malaysiaLocalDateTime(campaign.ends_at),
      posterUrl: campaign.poster_url,
      operatingHours: campaign.operating_hours ?? "",
    });
    const parsedHours = parseOperatingHours(campaign.operating_hours ?? "");
    setHoursFrom(parsedHours?.from ?? "");
    setHoursTo(parsedHours?.to ?? "");
  }

  function updateOperatingHours(nextFrom: string, nextTo: string) {
    setHoursFrom(nextFrom);
    setHoursTo(nextTo);
    setForm((prev) => ({ ...prev, operatingHours: composeOperatingHours(nextFrom, nextTo) }));
  }

  async function handlePosterChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/admin/promotion-campaigns/upload", { method: "POST", body: formData });
      const body = await response.json() as { data?: { url?: string }; error?: { message?: string } };
      if (!response.ok || !body.data?.url) throw new Error(body.error?.message ?? t("promotionCampaigns.errors.upload"));
      setForm((prev) => ({ ...prev, posterUrl: body.data!.url! }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("promotionCampaigns.errors.upload"));
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  function removePoster() {
    setForm((prev) => ({ ...prev, posterUrl: null }));
  }

  async function publishCampaign(campaignId: string, updatedAt: string) {
    const submitResponse = await fetch(`/api/admin/promotion-campaigns/${campaignId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit", expectedUpdatedAt: updatedAt }),
    });
    const submitPayload = await submitResponse.json();
    if (!submitResponse.ok) throw new Error(submitPayload.error?.message || t("promotionCampaigns.errors.transition"));

    const approveResponse = await fetch(`/api/admin/promotion-campaigns/${campaignId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", expectedUpdatedAt: submitPayload.data.updated_at }),
    });
    const approvePayload = await approveResponse.json();
    if (!approveResponse.ok) throw new Error(approvePayload.error?.message || t("promotionCampaigns.errors.transition"));
  }

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isInvalidDateTimeRange(form.startsAt, form.endsAt)) return;
    if (!editing && formLocations.length === 0) {
      setError(t("promotionCampaigns.locations.required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const campaignPayload = {
        title: form.title, slug: form.slug, summary: form.summary, description: form.description,
        startsAt: malaysiaDateTimeLocalToIso(form.startsAt), endsAt: malaysiaDateTimeLocalToIso(form.endsAt),
        posterUrl: form.posterUrl, operatingHours: form.operatingHours,
      };
      const response = await fetch(editing ? `/api/admin/promotion-campaigns/${editing.id}` : "/api/admin/promotion-campaigns", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { action: "save_draft", campaign: { ...campaignPayload, expectedUpdatedAt: editing.updated_at } } : campaignPayload),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || t("promotionCampaigns.errors.save"));
      const saved = payload.data as CampaignRow;
      if (!editing) {
        // The event exists now. If a location fails to save, it stays a draft:
        // clear the form so a retry can't create a duplicate event, and point
        // the admin at the row's Locations panel.
        for (const location of formLocations) {
          const locationResponse = await fetch(`/api/admin/promotion-campaigns/${saved.id}/locations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(toLocationPayload(location)),
          });
          if (!locationResponse.ok) {
            const locationPayload = await locationResponse.json().catch(() => ({}));
            resetForm();
            await reload();
            setError(`${locationPayload.error?.message ?? t("promotionCampaigns.locations.saveError")} ${t("promotionCampaigns.locations.savedAsDraft")}`);
            return;
          }
        }
      }
      if (saved.status === "draft" || saved.status === "rejected") {
        await publishCampaign(saved.id, saved.updated_at);
      }
      if (editing) showFeedback("success", t("promotionCampaigns.form.changesSaved"));
      resetForm();
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("promotionCampaigns.errors.save"));
    } finally {
      setBusy(false);
    }
  }

  async function transition(campaign: CampaignRow, action: "submit" | "approve" | "reject" | "pause" | "resume" | "archive") {
    let note: string | undefined;
    let confirmationMessage: string | null = null;
    if (action === "reject") {
      const value = await prompt(t("promotionCampaigns.prompts.rejectReason"));
      if (value === null) return;
      note = value;
    } else {
      switch (action) {
        case "submit": confirmationMessage = t("promotionCampaigns.prompts.confirm.submit"); break;
        case "approve": confirmationMessage = t("promotionCampaigns.prompts.confirm.approve"); break;
        case "pause": confirmationMessage = t("promotionCampaigns.prompts.confirm.pause"); break;
        case "archive": confirmationMessage = t("promotionCampaigns.prompts.confirm.archive"); break;
      }
      if (confirmationMessage && !await confirm(confirmationMessage)) return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/promotion-campaigns/${campaign.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedUpdatedAt: campaign.updated_at, ...(note ? { note } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || t("promotionCampaigns.errors.transition"));
      if (action === "submit") {
        await publishCampaign(campaign.id, payload.data.updated_at);
      }
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("promotionCampaigns.errors.transition"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPageShell>
      <AdminPageHeader
        eyebrow={<><Megaphone size={15} /> {t("promotionCampaigns.eyebrow")}</>}
        title={t("promotionCampaigns.title")}
        description={t("promotionCampaigns.description")}
        actions={<Button type="button" variant="outline" onClick={() => void reload()} disabled={loading || busy}><RefreshCw size={15} /> {t("promotionCampaigns.refresh")}</Button>}
      />

      {loading ? <p role="status" className="text-sm text-muted-foreground">{t("promotionCampaigns.states.loading")}</p> : forbidden ? (
        <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">{t("promotionCampaigns.errors.forbidden")}</div>
      ) : (
        <>
          {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
          <form onSubmit={(event) => void saveDraft(event)} className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="text-lg font-bold text-foreground">{editing ? t("promotionCampaigns.form.editTitle") : t("promotionCampaigns.form.title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("promotionCampaigns.form.guidance")}</p></div>
              {editing && <Button type="button" variant="ghost" onClick={resetForm}><X size={15} /> {t("promotionCampaigns.form.cancelEdit")}</Button>}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold text-foreground">{t("promotionCampaigns.form.name")}<input required minLength={3} maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 font-normal" /></label>
              <label className="text-sm font-semibold text-foreground">{t("promotionCampaigns.form.slug")}<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" minLength={3} maxLength={120} value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase().replace(/\s+/g, "-") })} className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 font-normal" /></label>
              <label className="text-sm font-semibold text-foreground md:col-span-2">{t("promotionCampaigns.form.summary")}<input required minLength={10} maxLength={240} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 font-normal" /></label>
              <label className="text-sm font-semibold text-foreground md:col-span-2">{t("promotionCampaigns.form.description")}<textarea required minLength={10} maxLength={5000} rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 font-normal" /></label>
              <label className="text-sm font-semibold text-foreground">{t("promotionCampaigns.form.startsAt")}<input required type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 font-normal" /></label>
              <label className="text-sm font-semibold text-foreground">{t("promotionCampaigns.form.endsAt")}<input required type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 font-normal" /></label>
              <div className="md:col-span-2">
                <span className="text-sm font-semibold text-foreground">{t("promotionCampaigns.form.operatingHours")}</span>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-muted-foreground">{t("promotionCampaigns.form.operatingHoursFrom")}<input required type="time" value={hoursFrom} onChange={(event) => updateOperatingHours(event.target.value, hoursTo)} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-normal text-foreground" /></label>
                  <label className="text-xs font-semibold text-muted-foreground">{t("promotionCampaigns.form.operatingHoursTo")}<input required type="time" value={hoursTo} min={hoursFrom || undefined} onChange={(event) => updateOperatingHours(hoursFrom, event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-normal text-foreground" /></label>
                </div>
                {form.operatingHours && <p className="mt-1.5 text-xs text-muted-foreground">{form.operatingHours}</p>}
              </div>
            </div>
            <div>
              <span className="mb-1 block text-sm font-semibold text-foreground">{t("promotionCampaigns.form.poster")}</span>
              {form.posterUrl ? (
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setPreviewUrl(form.posterUrl)} className="rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={form.posterUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  </button>
                  <Button type="button" variant="destructive" size="sm" onClick={removePoster}><X size={14} aria-hidden="true" /> {t("promotionCampaigns.form.removePoster")}</Button>
                </div>
              ) : (
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary">
                  {uploading ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
                  {t("promotionCampaigns.form.choosePoster")}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => void handlePosterChange(event)} disabled={uploading} />
                </label>
              )}
            </div>
            <div className="rounded-xl border border-border p-4">
              <EventLocationsEditor
                campaignId={editing?.id ?? null}
                locations={editing ? toEditableLocations(campaigns.find((campaign) => campaign.id === editing.id)?.locations) : formLocations}
                defaults={locationDefaultsFor(form.startsAt, form.endsAt)}
                onLocalChange={setFormLocations}
                onSaved={load}
              />
            </div>
            {isInvalidDateTimeRange(form.startsAt, form.endsAt) && <p role="alert" className="text-sm text-destructive">{t("promotionCampaigns.form.invalidRange")}</p>}
            <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || uploading || isInvalidDateTimeRange(form.startsAt, form.endsAt)}><Send size={15} /> {editing ? t("promotionCampaigns.form.saveChanges") : t("promotionCampaigns.form.saveDraft")}</Button><span className="self-center text-xs text-muted-foreground">{t("promotionCampaigns.form.timezone")}</span></div>
          </form>

          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-5 py-4"><h2 className="font-bold text-foreground">{t("promotionCampaigns.list.title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("promotionCampaigns.list.description", { count: campaigns.length })}</p></div>
            {campaigns.length === 0 ? <div className="p-8 text-center"><CalendarClock size={24} className="mx-auto text-muted-foreground" /><p className="mt-3 font-semibold text-foreground">{t("promotionCampaigns.states.empty")}</p><p className="mt-1 text-sm text-muted-foreground">{t("promotionCampaigns.states.emptyDescription")}</p></div> : <div className="divide-y divide-border">{campaigns.map((campaign) => <article key={campaign.id} className="grid gap-4 p-5 xl:grid-cols-[minmax(220px,1fr)_220px_130px_minmax(260px,auto)] xl:items-center">
              {openLocationsFor === campaign.id && (
                <div className="order-last rounded-xl border border-border bg-background p-4 xl:col-span-4">
                  <EventLocationsEditor
                    campaignId={campaign.id}
                    locations={toEditableLocations(campaign.locations)}
                    defaults={locationDefaultsFor(malaysiaLocalDateTime(campaign.starts_at), malaysiaLocalDateTime(campaign.ends_at))}
                    onSaved={load}
                    disabled={campaign.status === "archived"}
                  />
                </div>
              )}
              <div className="min-w-0"><h3 className="break-words font-semibold text-foreground">{campaign.title}</h3><p className="mt-1 break-all text-xs text-muted-foreground">/customer/events/{campaign.slug}</p>{campaign.rejection_note && <p className="mt-2 break-words rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"><span>{t("promotionCampaigns.list.rejection")}</span><span aria-hidden="true">: </span><span>{campaign.rejection_note}</span></p>}</div>
              <div className="text-xs text-muted-foreground"><p><span>{t("promotionCampaigns.form.startsAt")}</span><span aria-hidden="true">: </span><span>{formatDateTime(campaign.starts_at, locale, { timeZone: "Asia/Kuala_Lumpur" })}</span></p><p className="mt-1"><span>{t("promotionCampaigns.form.endsAt")}</span><span aria-hidden="true">: </span><span>{formatDateTime(campaign.ends_at, locale, { timeZone: "Asia/Kuala_Lumpur" })}</span></p></div>
              <span className="w-fit rounded-full bg-secondary px-3 py-1 text-xs font-bold text-foreground">{t(`promotionCampaigns.status.${campaign.status}`)}</span>
              <div className="flex flex-wrap gap-2 xl:justify-end"><Button type="button" variant="outline" size="sm" aria-expanded={openLocationsFor === campaign.id} onClick={() => setOpenLocationsFor((current) => (current === campaign.id ? null : campaign.id))}><MapPin size={14} /> {t("promotionCampaigns.locations.toggle", { count: campaign.locations?.length ?? 0 })}</Button>{(campaign.status === "draft" || campaign.status === "rejected") && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => editCampaign(campaign)}><Save size={14} /> {t("promotionCampaigns.actions.edit")}</Button>}{actionForStatus(campaign.status).map((action) => <Button key={action} type="button" size="sm" variant={action === "reject" || action === "archive" ? "outline" : "default"} disabled={busy} onClick={() => void transition(campaign, action)}>{action === "approve" ? <ShieldCheck size={14} /> : action === "submit" ? <Send size={14} /> : null}{t(`promotionCampaigns.actions.${action}`)}</Button>)}</div>
            </article>)}</div>}
          </section>

          <Dialog open={Boolean(previewUrl)} onOpenChange={(open) => { if (!open) setPreviewUrl(null); }}>
            <DialogContent className="sm:max-w-xl">
              <DialogTitle className="sr-only">{t("promotionCampaigns.form.poster")}</DialogTitle>
              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="" className="w-full rounded-lg object-contain" />
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </AdminPageShell>
  );
}
