'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { formatDateTime } from '@/lib/i18n/format';
import { DEFAULT_LOCALE, isAppLocale } from '@/lib/i18n/locale';

interface Announcement {
  id: string;
  title: string;
  body: string;
  senderCode: string;
  campaignId: string | null;
  createdAt: string;
  isRead: boolean;
}

export default function VendorAnnouncementsPage() {
  const { t, i18n } = useTranslation('vendor');
  const { user } = useAuth();
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  const vendorId = user?.activeVendorId;

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!vendorId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/vendors/${vendorId}/announcements`, { cache: 'no-store' });
      const body = await response.json() as { data?: { announcements?: Announcement[] }; error?: { message?: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? t('ui.announcements.loadError'));
      setAnnouncements(body.data.announcements ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ui.announcements.loadError'));
    } finally {
      setLoading(false);
    }
  }, [vendorId, t]);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  if (!vendorId) {
    return <div className="p-8 text-sm text-muted-foreground">{t('ui.announcements.noVendor')}</div>;
  }

  const unreadCount = announcements.filter((item) => !item.isRead).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center gap-3">
        <Bell className="text-primary" size={24} aria-hidden="true" />
        <div>
          <h1 className="text-xl font-bold text-foreground">
            {t('ui.announcements.title')}
            {unreadCount > 0 && <span className="ml-2 text-sm font-semibold text-primary">{t('ui.announcements.unreadCount', { count: unreadCount })}</span>}
          </h1>
          <p className="text-sm text-muted-foreground">{t('ui.announcements.description')}</p>
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('ui.announcements.loading')}</p>
      ) : announcements.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">{t('ui.announcements.empty')}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{t('ui.announcements.columns.title')}</th>
                <th className="px-4 py-3">{t('ui.announcements.columns.sender')}</th>
                <th className="px-4 py-3">{t('ui.announcements.columns.date')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {announcements.map((announcement) => (
                <tr key={announcement.id} className={announcement.isRead ? '' : 'bg-primary/5'}>
                  <td className="px-4 py-3">
                    <Link href={`/vendor/announcements/${announcement.id}`} className={`hover:underline ${announcement.isRead ? 'text-foreground' : 'font-bold text-primary'}`}>
                      {announcement.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{announcement.senderCode}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(announcement.createdAt, locale, { timeZone: 'Asia/Kuala_Lumpur' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
