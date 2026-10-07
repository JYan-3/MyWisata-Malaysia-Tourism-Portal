"use client";
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
export default function GuestOrderAccessPage() {
  const router = useRouter();
  const {t} = useTranslation("customer");
  const [failed,setFailed] = useState(false);
  const [orderId,setOrderId] = useState('');
  const [email,setEmail] = useState('');
  const [message,setMessage] = useState('');
  const [sending,setSending] = useState(false);
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    window.history.replaceState(null,'',window.location.pathname);
    if (!token) { setFailed(true); return; }
    fetch('/api/guest/orders/access',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}) })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(body => router.replace(`/customer/orders/${body.data.orderId}`)).catch(()=>setFailed(true));
  },[router]);
  async function recover(event:React.FormEvent) {
    event.preventDefault();setSending(true);
    try {
      const response=await fetch('/api/guest/orders/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId,email})});
      setMessage(response.ok ? t("guestCheckout.requested") : t("guestCheckout.requestFailed"));
    } catch {setMessage(t("guestCheckout.requestFailed"));}
    finally {setSending(false);}
  }
  return <div className="mx-auto max-w-lg px-4 py-16 text-foreground">
    {!failed ? <p>{t("guestCheckout.opening")}</p> : <form onSubmit={recover} className="space-y-4 rounded-2xl border border-border bg-card p-6">
      <h1 className="text-xl font-semibold">{t("guestCheckout.accessTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("guestCheckout.recoveryHint")}</p>
      <label className="block text-sm">{t("guestCheckout.orderNumber")}<Input required value={orderId} onChange={event=>setOrderId(event.target.value)} /></label>
      <label className="block text-sm">{t("guestCheckout.email")}<Input required type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} /></label>
      <Button type="submit" disabled={sending}>{t("guestCheckout.emailLink")}</Button>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </form>}
  </div>;
}
