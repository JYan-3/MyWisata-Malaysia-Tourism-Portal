'use client';

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Props = {
  open: boolean;
  onClose: () => void;
  onSent: (email: string) => void;
};

/** Invites the owner of a new event vendor by email. The vendor is created when they accept. */
export function CreateEventVendorModal({ open, onClose, onSent }: Props) {
  const { t } = useTranslation('admin');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (sending) return;
    setBusinessName('');
    setEmail('');
    setMessage('');
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/vendors/event-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName: businessName.trim(), email: email.trim(), ...(message.trim() ? { message: message.trim() } : {}) }),
      });
      const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
      if (!response.ok) {
        throw new Error(body.error?.code === 'OWNER_ALREADY_HAS_VENDOR'
          ? t('ui.vendors.eventVendor.ownerHasVendor')
          : body.error?.code === 'EMAIL_DELIVERY_FAILED'
            ? t('ui.vendors.eventVendor.emailFailed')
            : t('ui.vendors.eventVendor.error'));
      }
      const sentTo = email.trim();
      setSending(false);
      setBusinessName('');
      setEmail('');
      setMessage('');
      onSent(sentTo);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('ui.vendors.eventVendor.error'));
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('ui.vendors.eventVendor.title')}</DialogTitle>
            <DialogDescription>{t('ui.vendors.eventVendor.description')}</DialogDescription>
          </DialogHeader>
          <div>
            <label htmlFor="event-vendor-name" className="mb-1 block text-xs font-semibold text-muted-foreground">{t('ui.vendors.eventVendor.businessName')}</label>
            <Input id="event-vendor-name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} minLength={2} maxLength={120} required />
          </div>
          <div>
            <label htmlFor="event-vendor-email" className="mb-1 block text-xs font-semibold text-muted-foreground">{t('ui.vendors.eventVendor.ownerEmail')}</label>
            <Input id="event-vendor-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} required />
          </div>
          <div>
            <label htmlFor="event-vendor-message" className="mb-1 block text-xs font-semibold text-muted-foreground">{t('ui.vendors.eventVendor.message')}</label>
            <Textarea id="event-vendor-message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={3} />
          </div>
          <p className="text-xs text-muted-foreground">{t('ui.vendors.eventVendor.kycNote')}</p>
          {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={sending}>{t('ui.vendors.eventVendor.cancel')}</Button>
            <Button type="submit" disabled={sending}>{sending ? t('ui.vendors.eventVendor.sending') : t('ui.vendors.eventVendor.send')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
