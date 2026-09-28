'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { ArrowRight, PartyPopper } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { StatusBadge } from '@/components/ui/badge';
import type { PromotionCampaignPublic } from '@/lib/promotion-campaigns/types';

interface RegistrationSummary { campaignId: string; status: string }

export default function VendorEventsPage() {
  const { t } = useTranslation('vendor');
  const { user } = useAuth();
  const vendorId = user?.activeVendorId;

  const [campaigns, setCampaigns] = useState<PromotionCampaignPublic[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!vendorId) return;
    setLoading(true);
    setError(null);
    try {
      const [campaignsResponse, registrationsResponse] = await Promise.all([
        fetch('/api/customer/promotion-campaigns', { cache: 'no-store' }),
        fetch(`/api/vendors/${vendorId}/campaign-registrations`, { cache: 'no-store' }),
      ]);
      const campaignsBody = await campaignsResponse.json() as { data?: { campaigns?: PromotionCampaignPublic[] }; error?: { message?: string } };
      if (!campaignsResponse.ok || !campaignsBody.data) throw new Error(campaignsBody.error?.message ?? t('ui.events.loadError'));
      const registrationsBody = await registrationsResponse.json() as { data?: { registrations?: { campaignId: string; status: string }[] } };
      setCampaigns(campaignsBody.data.campaigns ?? []);
      setRegistrations((registrationsResponse.ok ? registrationsBody.data?.registrations ?? [] : []).map((r) => ({ campaignId: r.campaignId, status: r.status })));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ui.events.loadError'));
    } finally {
      setLoading(false);
    }
  }, [vendorId, t]);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  if (!vendorId) {
    return <div className="p-8 text-sm text-muted-foreground">{t('ui.events.noVendor')}</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center gap-3">
        <PartyPopper className="text-primary" size={24} aria-hidden="true" />
        <div>
          <h1 className="text-xl font-bold text-foreground">{t('ui.events.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('ui.events.description')}</p>
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('ui.events.loading')}</p>
      ) : campaigns.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">{t('ui.events.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {campaigns.map((campaign) => {
            const registration = registrations.find((r) => r.campaignId === campaign.id);
            return (
              <li key={campaign.id}>
                <Link href={`/vendor/events/${campaign.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 hover:bg-secondary/40">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{campaign.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{campaign.startsAt.slice(0, 10)} – {campaign.endsAt.slice(0, 10)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {registration ? <StatusBadge status={registration.status} /> : <span className="text-xs font-semibold text-primary">{t('ui.events.registerCta')}</span>}
                    <ArrowRight size={16} className="text-muted-foreground" aria-hidden="true" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
