"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { AdminPageHeader, AdminPageShell } from "@/components/admin/admin-page-shell";
import { AdminConfirmDialog } from "@/components/admin/confirm-dialog";
import { formatMYR } from "@/lib/i18n/format";
import { useActionFeedback } from "@/components/providers/action-feedback";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/badge";
import { useAppDialog } from "@/components/providers/app-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface AdminCampaignProduct {
  id: string;
  name: string;
  price: number;
  imageUrl: string | null;
  itemKind: "product" | "service";
  dailyQuantity: number;
  active: boolean;
}

interface AdminCampaignRegistrationDetail {
  id: string;
  campaignId: string;
  campaignTitle: string;
  locationName: string;
  vendorId: string;
  vendorName: string;
  stallNumber: string;
  stallDescription: string;
  stallPosterUrl: string;
  status: "pending" | "approved" | "rejected" | "changes_requested" | "withdrawn" | "removed";
  rejectionReason: string | null;
  closedReason?: string | null;
  changesRequestedReason: string | null;
  products: AdminCampaignProduct[];
  createdAt: string;
}

type ReviewAction = "approve" | "reject" | "request_changes";

export default function EventRegistrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useTranslation("admin");
  const { showFeedback } = useActionFeedback();
  const [detail, setDetail] = useState<AdminCampaignRegistrationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submittingAction, setSubmittingAction] = useState<ReviewAction | null>(null);
  const [pendingAction, setPendingAction] = useState<ReviewAction | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { prompt } = useAppDialog();


  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/event-registrations/${id}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message ?? (response.status === 404 ? t("eventRegistrations.errors.notFound") : t("eventRegistrations.errors.load")));
      setDetail(body.data?.registration ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("eventRegistrations.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function removeFromLocation() {
    const reason = await prompt(t("eventRegistrations.removePrompt"));
    if (reason === null) return;
    if (reason.trim().length < 5) {
      showFeedback("error", t("eventRegistrations.removeReasonRequired"));
      return;
    }
    setRemoving(true);
    try {
      const response = await fetch(`/api/admin/event-registrations/${id}/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message ?? t("eventRegistrations.removeError"));
      showFeedback("success", t("eventRegistrations.removed"));
      await load();
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : t("eventRegistrations.removeError"));
    } finally {
      setRemoving(false);
    }
  }

  function requestReview(action: ReviewAction) {
    if (submittingAction) return;
    if (action !== "approve" && note.trim().length < 10) {
      showFeedback("error", t("eventRegistrations.noteRequired"));
      return;
    }
    setPendingAction(action);
  }

  async function confirmReview() {
    if (!pendingAction) return;
    const action = pendingAction;
    setSubmittingAction(action);
    try {
      const response = await fetch(`/api/admin/event-registrations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: action === "approve" ? undefined : note.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message ?? t("eventRegistrations.errors.review"));
      showFeedback("success", t(`eventRegistrations.actions.${action}Success`));
      setNote("");
      await load();
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : t("eventRegistrations.errors.review"));
    } finally {
      setSubmittingAction(null);
      setPendingAction(null);
    }
  }

  const confirmCopy: Record<ReviewAction, { title: string; description: string; confirmLabel: string; confirmVariant: "default" | "destructive" }> = {
    approve: { title: t("eventRegistrations.confirm.approveTitle"), description: t("eventRegistrations.confirm.approveDescription"), confirmLabel: t("eventRegistrations.actions.approve"), confirmVariant: "default" },
    request_changes: { title: t("eventRegistrations.confirm.requestChangesTitle"), description: t("eventRegistrations.confirm.requestChangesDescription"), confirmLabel: t("eventRegistrations.actions.requestChanges"), confirmVariant: "default" },
    reject: { title: t("eventRegistrations.confirm.rejectTitle"), description: t("eventRegistrations.confirm.rejectDescription"), confirmLabel: t("eventRegistrations.actions.reject"), confirmVariant: "destructive" },
  };

  return (
    <AdminPageShell>
      <Link href="/admin/event-registrations" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft size={16} aria-hidden="true" />
        {t("eventRegistrations.backToQueue")}
      </Link>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("eventRegistrations.loading")}</p>
      ) : error || !detail ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>
      ) : (
        <>
          <AdminPageHeader
            title={detail.vendorName}
            description={`${detail.campaignTitle} · ${detail.locationName} · ${t("eventRegistrations.stallLabel", { number: detail.stallNumber })}`}
            actions={<StatusBadge status={detail.status} />}
          />

          <div className="grid gap-5 md:grid-cols-[480px_1fr]">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="block overflow-hidden rounded-xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={detail.stallPosterUrl} alt="" className="h-72 w-full object-cover md:h-full" />
            </button>
            <div className="space-y-4">
              <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{detail.stallDescription}</p>

              {detail.products.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-foreground">{t("eventRegistrations.productsHeading")}</h2>
                  <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                    {detail.products.map((product) => (
                      <li key={product.id} className="flex items-center gap-3 p-3">
                        {product.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={product.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <div className="h-12 w-12 shrink-0 rounded-lg bg-secondary" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{product.name}</span>
                          <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                            <span>{t(`eventRegistrations.itemKinds.${product.itemKind}`)}</span>
                            <span>{t("eventRegistrations.dailyQuantity", { count: product.dailyQuantity })}</span>
                            {!product.active && <span className="text-destructive">{t("eventRegistrations.itemOff")}</span>}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold text-foreground">{product.price === 0 ? t("eventRegistrations.free") : formatMYR(product.price)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.status === "rejected" && detail.rejectionReason && (
                <p className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive">{t("eventRegistrations.rejectionNote", { note: detail.rejectionReason })}</p>
              )}
              {(detail.status === "withdrawn" || detail.status === "removed") && (
                <p className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive">{t(`eventRegistrations.closedNote.${detail.status}`, { note: detail.closedReason ?? "" })}</p>
              )}
              {detail.status === "changes_requested" && detail.changesRequestedReason && (
                <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-300">{t("eventRegistrations.changesRequestedNote", { note: detail.changesRequestedReason })}</p>
              )}
            </div>
          </div>

          {detail.status === "pending" && (
            <section className="space-y-3 rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground">{t("eventRegistrations.reviewHeading")}</h2>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("eventRegistrations.notePlaceholder")}
                maxLength={1000}
                rows={3}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={submittingAction !== null} onClick={() => requestReview("approve")}>
                  {t("eventRegistrations.actions.approve")}
                </Button>
                <Button type="button" variant="outline" disabled={submittingAction !== null} onClick={() => requestReview("request_changes")}>
                  {t("eventRegistrations.actions.requestChanges")}
                </Button>
                <Button type="button" variant="outline" disabled={submittingAction !== null} onClick={() => requestReview("reject")}>
                  {t("eventRegistrations.actions.reject")}
                </Button>
              </div>
            </section>
          )}

          {detail.status === "approved" && (
            <section className="space-y-2 rounded-xl border border-destructive/30 bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground">{t("eventRegistrations.removeHeading")}</h2>
              <p className="text-xs text-muted-foreground">{t("eventRegistrations.removeDescription")}</p>
              <Button type="button" variant="destructive" size="sm" disabled={removing} onClick={() => void removeFromLocation()}>
                {t("eventRegistrations.actions.remove")}
              </Button>
            </section>
          )}

          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <DialogContent className="sm:max-w-2xl">
              <DialogTitle className="sr-only">{detail.vendorName}</DialogTitle>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={detail.stallPosterUrl} alt="" className="w-full rounded-lg object-contain" />
            </DialogContent>
          </Dialog>
        </>
      )}

      {pendingAction && (
        <AdminConfirmDialog
          open
          title={confirmCopy[pendingAction].title}
          description={confirmCopy[pendingAction].description}
          confirmLabel={confirmCopy[pendingAction].confirmLabel}
          confirmVariant={confirmCopy[pendingAction].confirmVariant}
          busy={submittingAction !== null}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void confirmReview()}
        />
      )}
    </AdminPageShell>
  );
}
