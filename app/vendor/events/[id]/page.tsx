'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, ImagePlus, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useDebounce } from '@/hooks/use-debounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useActionFeedback } from '@/components/providers/action-feedback';
import { formatMYR } from '@/lib/i18n/format';
import type { PromotionCampaignPublic } from '@/lib/promotion-campaigns/types';

interface ProductPick {
  key: string;
  kind: 'existing' | 'new';
  productId: string | null;
  name: string;
  price: number;
  imageUrl: string | null;
}

interface Registration {
  id: string;
  campaignId: string;
  stallNumber: string;
  stallDescription: string;
  stallPosterUrl: string;
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  rejectionReason: string | null;
  changesRequestedReason: string | null;
  products: { id: string; name: string; price: number; imageUrl: string | null }[];
}

interface ProductSearchResult {
  id: string;
  name: string;
  base_price: number;
  cover_url: string | null;
}

interface RegistrationDraft {
  savedAt: string;
  form: { stallNumber: string; stallDescription: string; stallPosterUrl: string | null };
  picks: ProductPick[];
  newProductName: string;
  newProductPrice: string;
  newProductImage: string | null;
}

function eventDraftStorageKey(vendorId: string, campaignId: string) {
  return `vendor-event-registration-draft:${vendorId}:${campaignId}`;
}

const EMPTY_FORM = { stallNumber: '', stallDescription: '', stallPosterUrl: '' as string | null };

export default function VendorEventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useTranslation('vendor');
  const { user } = useAuth();
  const { showFeedback } = useActionFeedback();
  const vendorId = user?.activeVendorId;

  const [campaign, setCampaign] = useState<PromotionCampaignPublic | null>(null);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [picks, setPicks] = useState<ProductPick[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductImage, setNewProductImage] = useState<string | null>(null);
  const [draftBanner, setDraftBanner] = useState<{ savedAt: string } | null>(null);
  const draftSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const found = (campaignsBody.data.campaigns ?? []).find((c) => c.id === id) ?? null;
      setCampaign(found);

      const registrationsBody = await registrationsResponse.json() as { data?: { registrations?: Registration[] } };
      const myRegistration = registrationsResponse.ok ? (registrationsBody.data?.registrations ?? []).find((r) => r.campaignId === id) ?? null : null;
      setRegistration(myRegistration);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ui.events.loadError'));
    } finally {
      setLoading(false);
    }
  }, [vendorId, id, t]);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  useEffect(() => {
    if (!vendorId) return;
    const raw = window.localStorage.getItem(eventDraftStorageKey(vendorId, id));
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as RegistrationDraft;
      if (parsed?.savedAt) setDraftBanner({ savedAt: parsed.savedAt });
    } catch {
      window.localStorage.removeItem(eventDraftStorageKey(vendorId, id));
    }
  }, [vendorId, id]);

  useEffect(() => {
    if (!vendorId || !editing) return;
    if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);
    draftSaveTimeoutRef.current = setTimeout(() => {
      const draft: RegistrationDraft = { savedAt: new Date().toISOString(), form, picks, newProductName, newProductPrice, newProductImage };
      window.localStorage.setItem(eventDraftStorageKey(vendorId, id), JSON.stringify(draft));
    }, 600);
    return () => { if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current); };
  }, [vendorId, id, editing, form, picks, newProductName, newProductPrice, newProductImage]);

  function resumeDraft() {
    if (!vendorId) return;
    const raw = window.localStorage.getItem(eventDraftStorageKey(vendorId, id));
    setDraftBanner(null);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as RegistrationDraft;
      setForm(parsed.form ?? EMPTY_FORM);
      setPicks(parsed.picks ?? []);
      setNewProductName(parsed.newProductName ?? '');
      setNewProductPrice(parsed.newProductPrice ?? '');
      setNewProductImage(parsed.newProductImage ?? null);
      setEditing(true);
    } catch {
      window.localStorage.removeItem(eventDraftStorageKey(vendorId, id));
    }
  }

  function discardDraft() {
    if (vendorId) window.localStorage.removeItem(eventDraftStorageKey(vendorId, id));
    setDraftBanner(null);
  }

  function startForm(existing?: Registration) {
    if (existing) {
      setForm({ stallNumber: existing.stallNumber, stallDescription: existing.stallDescription, stallPosterUrl: existing.stallPosterUrl });
      setPicks(existing.products.map((product) => ({ key: product.id, kind: 'new', productId: null, name: product.name, price: product.price, imageUrl: product.imageUrl })));
    } else {
      setForm(EMPTY_FORM);
      setPicks([]);
    }
    setEditing(true);
  }

  async function handlePosterChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !vendorId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`/api/vendors/${vendorId}/event-promotions/upload`, { method: 'POST', body: formData });
      const body = await response.json() as { data?: { url?: string }; error?: { message?: string } };
      if (!response.ok || !body.data?.url) throw new Error(body.error?.message ?? t('ui.events.uploadError'));
      setForm((prev) => ({ ...prev, stallPosterUrl: body.data!.url! }));
    } catch (err) {
      showFeedback('error', err instanceof Error ? err.message : t('ui.events.uploadError'));
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  async function handleNewProductImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !vendorId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`/api/vendors/${vendorId}/event-promotions/upload`, { method: 'POST', body: formData });
      const body = await response.json() as { data?: { url?: string }; error?: { message?: string } };
      if (!response.ok || !body.data?.url) throw new Error(body.error?.message ?? t('ui.events.uploadError'));
      setNewProductImage(body.data!.url!);
    } catch (err) {
      showFeedback('error', err instanceof Error ? err.message : t('ui.events.uploadError'));
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const loadProductOptions = useCallback(async (query: string) => {
    if (!vendorId) return;
    setSearching(true);
    try {
      const params = new URLSearchParams({ pageSize: '20', sort: 'name' });
      if (query.trim()) params.set('q', query.trim());
      const response = await fetch(`/api/vendors/${vendorId}/products?${params.toString()}`, { cache: 'no-store' });
      const body = await response.json() as { data?: { items?: ProductSearchResult[] } };
      setSearchResults(response.ok ? body.data?.items ?? [] : []);
    } finally {
      setSearching(false);
    }
  }, [vendorId]);

  useEffect(() => {
    if (!productDropdownOpen) return;
    void loadProductOptions(debouncedSearchQuery);
  }, [productDropdownOpen, debouncedSearchQuery, loadProductOptions]);

  function addExistingProduct(product: ProductSearchResult) {
    if (picks.some((pick) => pick.productId === product.id)) return;
    setPicks((prev) => [...prev, { key: `existing-${product.id}`, kind: 'existing', productId: product.id, name: product.name, price: product.base_price, imageUrl: product.cover_url }]);
  }

  function addNewProduct() {
    const price = Number(newProductPrice);
    if (!newProductName.trim() || !Number.isFinite(price) || price < 0) return;
    setPicks((prev) => [...prev, { key: `new-${Date.now()}`, kind: 'new', productId: null, name: newProductName.trim(), price, imageUrl: newProductImage }]);
    setNewProductName('');
    setNewProductPrice('');
    setNewProductImage(null);
  }

  function removePick(key: string) {
    setPicks((prev) => prev.filter((pick) => pick.key !== key));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!vendorId || submitting) return;
    if (!form.stallPosterUrl) {
      showFeedback('error', t('ui.events.posterRequired'));
      return;
    }
    if (picks.length === 0) {
      showFeedback('error', t('ui.events.productsRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const products = picks.map((pick) => pick.kind === 'existing'
        ? { kind: 'existing' as const, productId: pick.productId! }
        : { kind: 'new' as const, name: pick.name, price: pick.price, imageUrl: pick.imageUrl });
      const payload = {
        stallNumber: form.stallNumber.trim(),
        stallDescription: form.stallDescription.trim(),
        stallPosterUrl: form.stallPosterUrl,
        products,
      };
      const response = registration
        ? await fetch(`/api/vendors/${vendorId}/campaign-registrations/${registration.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
        : await fetch(`/api/vendors/${vendorId}/campaign-registrations`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, campaignId: id }),
        });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? t('ui.events.submitError'));
      showFeedback('success', registration ? t('ui.events.resubmitSuccess') : t('ui.events.submitSuccess'));
      if (vendorId) window.localStorage.removeItem(eventDraftStorageKey(vendorId, id));
      setEditing(false);
      await load();
    } catch (err) {
      showFeedback('error', err instanceof Error ? err.message : t('ui.events.submitError'));
    } finally {
      setSubmitting(false);
    }
  }

  if (!vendorId) {
    return <div className="p-8 text-sm text-muted-foreground">{t('ui.events.noVendor')}</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <Link href="/vendor/events" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft size={16} aria-hidden="true" /> {t('ui.events.backToEvents')}
      </Link>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('ui.events.loading')}</p>
      ) : error || !campaign ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error ?? t('ui.events.notFound')}</p>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-5">
            {campaign.posterUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={campaign.posterUrl} alt="" className="mb-4 h-48 w-full rounded-lg object-cover" />
            )}
            <h1 className="text-xl font-bold text-foreground">{campaign.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{campaign.description}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>{campaign.startsAt.slice(0, 10)} – {campaign.endsAt.slice(0, 10)}</span>
              {campaign.operatingHours && <span>{campaign.operatingHours}</span>}
            </div>
          </div>

          {draftBanner && !editing && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-sm text-foreground">{t('ui.events.draftFound')}</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={resumeDraft}>{t('ui.events.actions.resumeDraft')}</Button>
                <Button type="button" size="sm" variant="outline" onClick={discardDraft}>{t('ui.events.actions.discardDraft')}</Button>
              </div>
            </div>
          )}

          {registration && !editing && (
            <section className="space-y-3 rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">{t('ui.events.yourRegistration')}</h2>
                <StatusBadge status={registration.status} />
              </div>
              <p className="text-sm text-foreground">{t('ui.events.fields.stallNumber')}: {registration.stallNumber}</p>
              <p className="text-sm text-muted-foreground">{registration.stallDescription}</p>
              {registration.status === 'rejected' && registration.rejectionReason && (
                <p className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive">{t('ui.events.rejectionNote', { note: registration.rejectionReason })}</p>
              )}
              {registration.status === 'changes_requested' && (
                <>
                  {registration.changesRequestedReason && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-300">{t('ui.events.changesRequestedNote', { note: registration.changesRequestedReason })}</p>}
                  <Button type="button" size="sm" variant="outline" onClick={() => startForm(registration)}>{t('ui.events.actions.editAndResubmit')}</Button>
                </>
              )}
            </section>
          )}

          {!registration && !editing && (
            <Button type="button" onClick={() => startForm()}>{t('ui.events.actions.register')}</Button>
          )}

          {editing && (
            <form onSubmit={(event) => void submit(event)} className="space-y-4 rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground">{registration ? t('ui.events.editHeading') : t('ui.events.registerHeading')}</h2>

              <div>
                <label htmlFor="stall-number" className="mb-1 block text-xs font-semibold text-muted-foreground">{t('ui.events.fields.stallNumber')}</label>
                <Input id="stall-number" value={form.stallNumber} onChange={(e) => setForm((prev) => ({ ...prev, stallNumber: e.target.value }))} maxLength={40} required />
              </div>

              <div>
                <label htmlFor="stall-description" className="mb-1 block text-xs font-semibold text-muted-foreground">{t('ui.events.fields.stallDescription')}</label>
                <Textarea id="stall-description" value={form.stallDescription} onChange={(e) => setForm((prev) => ({ ...prev, stallDescription: e.target.value }))} maxLength={2000} rows={3} required />
              </div>

              <div>
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('ui.events.fields.poster')}</span>
                {form.stallPosterUrl ? (
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setPreviewUrl(form.stallPosterUrl)} className="rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={form.stallPosterUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
                    </button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => setForm((prev) => ({ ...prev, stallPosterUrl: '' }))}>
                      <Trash2 size={14} aria-hidden="true" /> {t('ui.events.fields.removeImage')}
                    </Button>
                  </div>
                ) : (
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary">
                    {uploading ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
                    {t('ui.events.fields.chooseImage')}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => void handlePosterChange(event)} disabled={uploading} />
                  </label>
                )}
              </div>

              <div className="rounded-lg border border-border p-4">
                <h3 className="text-sm font-semibold text-foreground">{t('ui.events.fields.products')}</h3>

                <div className="relative mt-3">
                  <label className="relative block">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onFocus={() => setProductDropdownOpen(true)}
                      onBlur={() => setProductDropdownOpen(false)}
                      placeholder={t('ui.events.fields.searchProducts')}
                      className="pl-9"
                    />
                  </label>
                  {productDropdownOpen && (
                    <div onMouseDown={(e) => e.preventDefault()} className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
                      {searching ? (
                        <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><Loader2 className="animate-spin" size={14} aria-hidden="true" /> {t('ui.events.loading')}</p>
                      ) : searchResults.length === 0 ? (
                        <p className="p-3 text-xs text-muted-foreground">{t('ui.events.fields.noProductsFound')}</p>
                      ) : (
                        <ul className="divide-y divide-border">
                          {searchResults.map((product) => {
                            const added = picks.some((pick) => pick.productId === product.id);
                            return (
                              <li key={product.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                                <span className="min-w-0 truncate">{product.name} — {formatMYR(product.base_price)}</span>
                                <Button type="button" size="sm" variant={added ? 'ghost' : 'outline'} disabled={added} onClick={() => addExistingProduct(product)}>
                                  {added ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                                </Button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-lg bg-secondary/40 p-3">
                  <p className="text-xs font-semibold text-muted-foreground">{t('ui.events.fields.addNewProduct')}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Input value={newProductName} onChange={(e) => setNewProductName(e.target.value)} placeholder={t('ui.events.fields.productName')} maxLength={120} />
                    <Input type="number" min={0} step={0.01} value={newProductPrice} onChange={(e) => setNewProductPrice(e.target.value)} placeholder={t('ui.events.fields.productPrice')} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {newProductImage ? (
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setPreviewUrl(newProductImage)} className="rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={newProductImage} alt="" className="h-14 w-14 rounded-lg object-cover" />
                        </button>
                        <Button type="button" variant="destructive" size="sm" onClick={() => setNewProductImage(null)}>
                          <Trash2 size={14} aria-hidden="true" /> {t('ui.events.fields.removeImage')}
                        </Button>
                      </div>
                    ) : (
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary">
                        {uploading ? <Loader2 className="animate-spin" size={14} aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />}
                        {t('ui.events.fields.addPhoto')}
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => void handleNewProductImageChange(event)} disabled={uploading} />
                      </label>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={addNewProduct}>
                      <Plus size={15} aria-hidden="true" /> {t('ui.events.actions.addProduct')}
                    </Button>
                  </div>
                </div>

                {picks.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {picks.map((pick) => (
                      <li key={pick.key} className="flex items-center justify-between gap-2 rounded-lg bg-background p-2 text-sm">
                        <span className="min-w-0 truncate">{pick.name} — {formatMYR(pick.price)} {pick.kind === 'new' && <span className="text-xs text-muted-foreground">({t('ui.events.fields.newForEvent')})</span>}</span>
                        <Button type="button" size="sm" variant="ghost" onClick={() => removePick(pick.key)}><Trash2 size={14} /></Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={submitting || uploading}>
                  {submitting ? t('ui.events.loading') : registration ? t('ui.events.actions.resubmit') : t('ui.events.actions.submitRegistration')}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setEditing(false); if (vendorId) window.localStorage.removeItem(eventDraftStorageKey(vendorId, id)); }}>{t('ui.events.actions.cancel')}</Button>
              </div>
            </form>
          )}

          <Dialog open={Boolean(previewUrl)} onOpenChange={(open) => { if (!open) setPreviewUrl(null); }}>
            <DialogContent className="sm:max-w-xl">
              <DialogTitle className="sr-only">{t('ui.events.fields.poster')}</DialogTitle>
              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="" className="w-full rounded-lg object-contain" />
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
