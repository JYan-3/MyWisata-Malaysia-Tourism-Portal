"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import type { StayBookingDetails } from "@/backend/core/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { stayBookingDetailsSchema } from "@/lib/validation/schemas";

export function StayGuestDetailsDialog({
  open,
  onOpenChange,
  adults: selectedAdults,
  initialDetails,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undefined only for an incomplete legacy cart line, where the guest count was never saved. */
  adults?: number;
  initialDetails?: StayBookingDetails | null;
  onSave: (details: StayBookingDetails) => Promise<void>;
}) {
  const { t } = useTranslation("customer");
  const [primaryGuestName, setPrimaryGuestName] = useState(initialDetails?.primaryGuestName ?? "");
  const [additionalGuestNames, setAdditionalGuestNames] = useState(initialDetails?.additionalGuestNames ?? []);
  const [adultCount, setAdultCount] = useState(selectedAdults ?? initialDetails?.adults ?? 1);
  const [estimatedArrival, setEstimatedArrival] = useState<StayBookingDetails["estimatedArrival"]>(initialDetails?.estimatedArrival ?? "unknown");
  const [specialRequest, setSpecialRequest] = useState(initialDetails?.specialRequest ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guestNameLimit = Math.max(0, adultCount - 1);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = stayBookingDetailsSchema.safeParse({
      primaryGuestName,
      additionalGuestNames: additionalGuestNames.map((name) => name.trim()).filter(Boolean),
      adults: adultCount,
      estimatedArrival,
      specialRequest: specialRequest.trim() || null,
    });
    if (!parsed.success) {
      setError(t("ui.property.stayDetailsInvalid"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(parsed.data);
      onOpenChange(false);
    } catch {
      setError(t("ui.property.stayDetailsSaveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("ui.property.guestDetails")}</DialogTitle>
          <DialogDescription>{t("ui.property.stayDetailsIntro")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          {selectedAdults !== undefined ? (
            <div className="rounded-xl bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
              {t("ui.property.adults")}: <span className="font-semibold text-foreground">{adultCount}</span>
            </div>
          ) : (
            <label className="block text-sm font-medium text-foreground">
              {t("ui.property.adults")}
              <Input type="number" min={1} max={20} value={adultCount} onChange={(event) => setAdultCount(Number(event.target.value))} className="mt-1 max-w-32" />
            </label>
          )}
          <label className="block text-sm font-medium text-foreground">
            {t("ui.property.primaryGuestName")} <span className="text-destructive">*</span>
            <Input autoComplete="name" maxLength={100} required value={primaryGuestName} onChange={(event) => setPrimaryGuestName(event.target.value)} className="mt-1" />
          </label>
          {additionalGuestNames.map((name, index) => (
            <div key={index} className="flex items-end gap-2">
              <label className="min-w-0 flex-1 text-sm font-medium text-foreground">
                {t("ui.property.additionalGuestName", { number: index + 1 })} <span className="text-xs font-normal text-muted-foreground">({t("ui.property.optional")})</span>
                <Input autoComplete="off" maxLength={100} value={name} onChange={(event) => setAdditionalGuestNames((current) => current.map((guest, guestIndex) => guestIndex === index ? event.target.value : guest))} className="mt-1" />
              </label>
              <Button type="button" variant="ghost" size="icon" aria-label={t("ui.property.removeGuestName", { number: index + 1 })} onClick={() => setAdditionalGuestNames((current) => current.filter((_, guestIndex) => guestIndex !== index))}>
                <Trash2 size={16} aria-hidden="true" />
              </Button>
            </div>
          ))}
          {additionalGuestNames.length < guestNameLimit && (
            <Button type="button" variant="outline" size="sm" onClick={() => setAdditionalGuestNames((current) => [...current, ""])}>
              <Plus size={15} aria-hidden="true" /> {t("ui.property.addGuestName")}
            </Button>
          )}
          <label className="block text-sm font-medium text-foreground">
            {t("ui.property.estimatedArrival")}
            <Select value={estimatedArrival} onValueChange={(value) => setEstimatedArrival(value as StayBookingDetails["estimatedArrival"])}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">{t("ui.property.arrivalUnknown")}</SelectItem>
                <SelectItem value="15:00-18:00">{t("ui.property.arrivalAfternoon")}</SelectItem>
                <SelectItem value="18:00-21:00">{t("ui.property.arrivalEvening")}</SelectItem>
                <SelectItem value="after-21:00">{t("ui.property.arrivalLate")}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="block text-sm font-medium text-foreground">
            {t("ui.property.specialRequest")} <span className="text-xs font-normal text-muted-foreground">({t("ui.property.optional")})</span>
            <Textarea maxLength={500} value={specialRequest} onChange={(event) => setSpecialRequest(event.target.value)} className="mt-1" />
          </label>
          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t("ui.property.cancel")}</Button>
            <Button type="submit" disabled={saving || !primaryGuestName.trim()}>{saving ? t("ui.outletMenu.adding") : t("ui.property.saveStayDetails")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
