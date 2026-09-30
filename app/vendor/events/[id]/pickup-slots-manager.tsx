'use client';

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActionFeedback } from '@/components/providers/action-feedback';
import { useAppDialog } from '@/components/providers/app-dialog';
import { DEFAULT_LOCALE, isAppLocale } from '@/lib/i18n/locale';
import { formatEventDate, formatEventHours } from '@/lib/promotion-campaigns/locations';

export interface PickupSlot {
  id: string;
  /** null = every day of the location; a date = extra slot on that day only. */
  slotDate: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
}

interface Props {
  vendorId: string;
  registrationId: string;
  slots: PickupSlot[];
  location: { startsOn: string; endsOn: string; opensAt: string; closesAt: string };
  onSaved: () => Promise<void>;
}

const ERROR_KEYS: Record<string, string> = {
  OUTSIDE_HOURS: 'ui.events.pickup.errors.outsideHours',
  OUTSIDE_DATES: 'ui.events.pickup.errors.outsideDates',
  DUPLICATE: 'ui.events.pickup.errors.duplicate',
  IN_USE: 'ui.events.pickup.errors.inUse',
};

/** Pickup windows customers choose from: the same every day, plus extras on chosen dates. */
export function PickupSlotsManager({ vendorId, registrationId, slots, location, onSaved }: Props) {
  const { t, i18n } = useTranslation('vendor');
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  const { showFeedback } = useActionFeedback();
  const { confirm } = useAppDialog();
  const [scope, setScope] = useState<'daily' | 'date'>('daily');
  const [slotDate, setSlotDate] = useState(location.startsOn);
  const [startsAt, setStartsAt] = useState(location.opensAt);
  const [endsAt, setEndsAt] = useState(location.closesAt);
  const [capacity, setCapacity] = useState('10');
  const [busy, setBusy] = useState(false);

  async function failureMessage(response: Response, fallback: string) {
    const body = await response.json().catch(() => ({})) as { error?: { code?: string } };
    const key = body.error?.code ? ERROR_KEYS[body.error.code] : undefined;
    return key ? t(key) : fallback;
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const max = Number(capacity);
    if (!Number.isInteger(max) || max < 1 || max > 10000 || endsAt <= startsAt) {
      showFeedback('error', t('ui.events.pickup.errors.invalid'));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/vendors/${vendorId}/pickup-slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId, slotDate: scope === 'date' ? slotDate : null, startsAt, endsAt, capacity: max }),
      });
      if (!response.ok) throw new Error(await failureMessage(response, t('ui.events.pickup.errors.saveFailed')));
      showFeedback('success', t('ui.events.pickup.saved'));
      await onSaved();
    } catch (err) {
      showFeedback('error', err instanceof Error ? err.message : t('ui.events.pickup.errors.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(slot: PickupSlot) {
    if (!(await confirm(t('ui.events.pickup.confirmRemove')))) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/vendors/${vendorId}/pickup-slots/${slot.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await failureMessage(response, t('ui.events.pickup.errors.removeFailed')));
      showFeedback('success', t('ui.events.pickup.removed'));
      await onSaved();
    } catch (err) {
      showFeedback('error', err instanceof Error ? err.message : t('ui.events.pickup.errors.removeFailed'));
    } finally {
      setBusy(false);
    }
  }

  const daily = slots.filter((slot) => !slot.slotDate);
  const extras = slots.filter((slot) => slot.slotDate);

  function slotRow(slot: PickupSlot) {
    return (
      <li key={slot.id} className="flex items-center justify-between gap-2 rounded-lg bg-background p-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <Clock size={14} className="shrink-0 text-primary" aria-hidden="true" />
          {slot.slotDate && <span className="font-semibold">{formatEventDate(slot.slotDate, locale)}</span>}
          <span>{formatEventHours(slot.startsAt, slot.endsAt, locale)}</span>
          <span className="text-xs text-muted-foreground">{t('ui.events.pickup.capacity', { count: slot.capacity })}</span>
        </span>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void remove(slot)} aria-label={t('ui.events.pickup.remove')}>
          <Trash2 size={14} aria-hidden="true" />
        </Button>
      </li>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground">{t('ui.events.pickup.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('ui.events.pickup.hint')}</p>
      </div>
      {slots.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-300">{t('ui.events.pickup.none')}</p>}
      {daily.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-foreground">{t('ui.events.pickup.everyDay')}</p>
          <ul className="space-y-1.5">{daily.map(slotRow)}</ul>
        </div>
      )}
      {extras.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-foreground">{t('ui.events.pickup.extraDates')}</p>
          <ul className="space-y-1.5">{extras.map(slotRow)}</ul>
        </div>
      )}

      <form onSubmit={(event) => void add(event)} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs text-muted-foreground">
          {t('ui.events.pickup.when')}
          <select value={scope} onChange={(e) => setScope(e.target.value as 'daily' | 'date')} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground">
            <option value="daily">{t('ui.events.pickup.everyDay')}</option>
            <option value="date">{t('ui.events.pickup.onDate')}</option>
          </select>
        </label>
        {scope === 'date' && (
          <label className="text-xs text-muted-foreground">
            {t('ui.events.pickup.date')}
            <Input type="date" min={location.startsOn} max={location.endsOn} value={slotDate} onChange={(e) => setSlotDate(e.target.value)} className="mt-1 h-9" required />
          </label>
        )}
        <label className="text-xs text-muted-foreground">
          {t('ui.events.pickup.from')}
          <Input type="time" min={location.opensAt} max={location.closesAt} step={900} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="mt-1 h-9" required />
        </label>
        <label className="text-xs text-muted-foreground">
          {t('ui.events.pickup.to')}
          <Input type="time" min={location.opensAt} max={location.closesAt} step={900} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="mt-1 h-9" required />
        </label>
        <label className="text-xs text-muted-foreground">
          {t('ui.events.pickup.max')}
          <Input type="number" min={1} max={10000} step={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} className="mt-1 h-9" required />
        </label>
        <div className="flex items-end">
          <Button type="submit" size="sm" disabled={busy} className="w-full">{t('ui.events.pickup.add')}</Button>
        </div>
      </form>
    </div>
  );
}
