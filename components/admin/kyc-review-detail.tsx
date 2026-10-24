"use client";

import { useVisibleReviewRefresh } from "@/hooks/use-visible-review-refresh";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckSquare,
  FileWarning,
  MessageSquare,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AdminKycReviewDetail, AdminKycSubmission } from "@/backend/core/types";
import { AdminPageHeader } from "@/components/admin/admin-page-shell";
import { AdminConfirmDialog } from "@/components/admin/confirm-dialog";
import { adminFilterControlClassName } from "@/components/admin/filter-bar";
import { useActionFeedback } from "@/components/providers/action-feedback";
import { Button } from "@/components/ui/button";
import { DEFAULT_LOCALE, isAppLocale } from "@/lib/i18n/locale";
import { KYC_REVIEW_REASON_CODES, type KycReviewReasonCode } from "@/lib/kyc/types";

export type KycReviewDecision = {
  action: "approve" | "reject" | "request_info";
  reasonCode?: KycReviewReasonCode;
  reasonDetail?: string;
};

type ReasonAction = "reject" | "request_info";

type KycReviewDetailContentProps = {
  detail: AdminKycReviewDetail;
  busy: boolean;
  error: string | null;
  onOpenDocument: (side: "front" | "back") => void;
  onDecision: (decision: KycReviewDecision) => void;
  documentPreview?: { side: "front" | "back"; url: string; pdf?: boolean } | null;
  documentLoading?: boolean;
  onCloseDocument?: () => void;
};

function statusKey(status: AdminKycSubmission["status"]) {
  return status === "info_requested" ? "infoRequested" : status;
}

export function KycReviewDetailContent({
  detail,
  busy,
  error,
  onOpenDocument,
  onDecision,
  documentPreview,
  documentLoading,
  onCloseDocument,
}: KycReviewDetailContentProps) {
  const { t, i18n } = useTranslation("admin");
  const { t: tCommon } = useTranslation("common");
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  const { customer, submission } = detail;
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const [reasonCode, setReasonCode] = useState<KycReviewReasonCode | "">("");
  const [reasonDetail, setReasonDetail] = useState("");
  const [confirmDecision, setConfirmDecision] = useState<KycReviewDecision | null>(null);

  const [confirmationVersion, setConfirmationVersion] = useState<number | null>(null);
  const actionable = submission.status === "pending" && detail.assignment.canDecide;
  const canContinue = Boolean(reasonCode) && (reasonCode !== "other" || reasonDetail.trim().length >= 10);
  const statusLabel = t(`kyc.status.${statusKey(submission.status)}`);
  const statusClassName = submission.status === "approved"
    ? "bg-nature-green text-nature-green-ink"
    : submission.status === "rejected"
      ? "bg-destructive/10 text-destructive"
      : submission.status === "info_requested"
        ? "bg-accent text-accent-foreground"
        : "bg-primary/10 text-primary";

  function beginReasonAction(action: ReasonAction) {
    setReasonAction(action);
    setReasonCode("");
    setReasonDetail("");
  }

  function prepareReasonDecision() {
    if (!reasonAction || !reasonCode || !canContinue) return;
    setConfirmationVersion(detail.assignment.reviewVersion);
    setConfirmDecision({
      action: reasonAction,
      reasonCode,
      ...(reasonDetail.trim() ? { reasonDetail: reasonDetail.trim() } : {}),
    });
  }

  function submitConfirmedDecision() {
    if (!confirmDecision || !actionable || confirmationVersion !== detail.assignment.reviewVersion) return;
    onDecision(confirmDecision);
    setConfirmDecision(null);
  }

  const confirmTitle = confirmDecision?.action === "approve"
    ? "kyc.confirm.approveTitle"
    : confirmDecision?.action === "reject"
      ? "kyc.confirm.rejectTitle"
      : "kyc.confirm.infoTitle";
  const confirmDescription = confirmDecision?.action === "approve"
    ? "kyc.confirm.approveDescription"
    : confirmDecision?.action === "reject"
      ? "kyc.confirm.rejectDescription"
      : "kyc.confirm.infoDescription";
  const confirmLabel = confirmDecision?.action === "approve"
    ? "kyc.confirm.approve"
    : confirmDecision?.action === "reject"
      ? "kyc.confirm.reject"
      : "kyc.confirm.info";
  const reviewedAt = submission.reviewedAt
    ? new Date(submission.reviewedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })
    : null;
  const submittedAt = new Date(submission.submittedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const reasonLabel = submission.reviewReasonCode && KYC_REVIEW_REASON_CODES.includes(submission.reviewReasonCode as KycReviewReasonCode)
    ? t(`kyc.reasons.${submission.reviewReasonCode}`)
    : submission.reviewReasonCode;

  return (
    <>
      <Link href="/admin/kyc" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
        <ArrowLeft size={16} />
        {t("kyc.detail.backToQueue")}
      </Link>

      <AdminPageHeader
        eyebrow={<><ShieldCheck size={18} /> {t("kyc.detail.eyebrow")}</>}
        title={customer.name}
        description={customer.email}
        actions={<span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusClassName}`}>{statusLabel}</span>}
      />

      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.42fr)]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">{t("kyc.detail.documents")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("kyc.detail.documentsDescription")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {submission.documents.map(({ side }) => (
                <Button key={side} variant="outline" size="sm" disabled={busy} onClick={() => onOpenDocument(side)}>
                  {t("kyc.detail.openDocument", { side: t(`kyc.detail.${side}`) })}
                </Button>
              ))}
            </div>
            {documentLoading && <p role="status" className="mt-4 text-sm text-muted-foreground">{t("kyc.detail.loading")}</p>}
            {documentPreview && <div className="mt-4 space-y-3">
              {documentPreview.pdf ? <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{t("kyc.detail.pdfNote")}</p>
                <Button asChild variant="outline" size="sm"><a href={documentPreview.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t("kyc.detail.openPdf")}</a></Button>
              </div> : <>
                {/* Authenticated bytes only; never send private evidence to an optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={documentPreview.url} alt={t("kyc.detail.previewAlt", { side: t(`kyc.detail.${documentPreview.side}`) })} className="max-h-[60vh] w-full rounded-lg border border-border object-contain" />
              </>}
              <Button variant="outline" size="sm" onClick={onCloseDocument}>{t("kyc.detail.closePreview")}</Button>
            </div>}
          </section>



          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">{t("kyc.detail.automatedChecks")}</h2>
            {submission.ocr ? (
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl bg-secondary/60 p-3">
                  <p className="font-medium text-foreground">{t("kyc.detail.ocrStatus", { status: t(`kyc.ocr.status.${submission.ocr.status}`) })}</p>
                  <p className="mt-1 text-muted-foreground">{t("kyc.ocr.extractedName", { name: submission.ocr.holderName ?? t("kyc.fallback.notAvailable") })}</p>
                  <p className="text-muted-foreground">{t("kyc.ocr.documentEnding", { number: submission.ocr.documentNumberLast4 ?? t("kyc.fallback.notAvailable") })}</p>
                </div>
                <div className="rounded-xl bg-secondary/60 p-3">
                  <p className="text-muted-foreground">{t("kyc.ocr.expiryDate", { date: submission.ocr.expiryDate ?? t("kyc.fallback.notAvailable") })}</p>
                  {submission.ocr.mismatchFields.length > 0 ? (
                    <p className="mt-1 flex items-start gap-1 text-destructive">
                      <FileWarning size={14} className="mt-0.5 shrink-0" />
                      {t("kyc.ocr.mismatch", { fields: submission.ocr.mismatchFields.join(", ").replaceAll("_", " ") })}
                    </p>
                  ) : (
                    <p className="mt-1 text-primary">{t("kyc.ocr.noMismatch")}</p>
                  )}
                </div>
              </div>
            ) : <p className="mt-3 text-sm text-muted-foreground">{t("kyc.detail.noAutomatedChecks")}</p>}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">{t("kyc.detail.identitySnapshot")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("kyc.detail.identitySnapshotDescription")}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">{t("kyc.detail.legalName")}</dt><dd className="mt-1 font-medium text-foreground">{submission.legalIdentity.fullName ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">{t("kyc.detail.snapshotEmail")}</dt><dd className="mt-1 font-medium text-foreground">{submission.legalIdentity.email ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">{t("kyc.detail.snapshotPhone")}</dt><dd className="mt-1 font-medium text-foreground">{submission.legalIdentity.phone ?? "—"}</dd></div>
            </dl>
          </section>
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">{t("kyc.operations.precheck")}</h2>
            <p className="mt-2 text-sm">{t(`kyc.operations.precheckStatus.${submission.precheck?.status ?? "none"}`)}</p>
            {submission.precheck?.outcome && <p className="mt-2 text-sm">{t(`kyc.operations.precheckOutcome.${submission.precheck.outcome}`)}</p>}
            <p className="mt-2 text-xs text-muted-foreground">{t("kyc.operations.precheckNote")}</p>
          </section>
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">{t("kyc.detail.submission")}</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-muted-foreground">{t("kyc.detail.documentType")}</dt><dd className="mt-1 font-medium text-foreground">{t(`kyc.documents.${submission.docType}`)}</dd></div>
              <div><dt className="text-muted-foreground">{t("kyc.detail.submittedAt")}</dt><dd className="mt-1 font-medium text-foreground">{submittedAt}</dd></div>
              <div><dt className="text-muted-foreground">{t("kyc.detail.queuePosition")}</dt><dd className="mt-1 font-medium text-foreground">{submission.queuePosition ?? "—"}</dd></div>
            </dl>
          </section>

          {submission.status === "pending" && !detail.assignment.canDecide ? (
            <section className="rounded-2xl border border-border bg-muted/50 p-5">
              <h2 className="font-semibold text-foreground">{t("kyc.detail.assignedElsewhere")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("kyc.detail.assignedElsewhereDescription")}</p>
            </section>
          ) : actionable ? (
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-semibold text-foreground">{t("kyc.detail.decision")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("kyc.detail.decisionDescription")}</p>
              <div className="mt-4 grid gap-2">
                <Button disabled={busy} onClick={() => { setConfirmationVersion(detail.assignment.reviewVersion); setConfirmDecision({ action: "approve" }); }}><CheckSquare size={14} /> {t("kyc.detail.approve")}</Button>
                <Button variant="outline" disabled={busy} onClick={() => beginReasonAction("request_info")}><MessageSquare size={14} /> {t("kyc.detail.requestInfo")}</Button>
                <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10" disabled={busy} onClick={() => beginReasonAction("reject")}><XCircle size={14} /> {t("kyc.detail.reject")}</Button>
              </div>

              {reasonAction && (
                <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 p-4">
                  <p className="text-sm font-semibold text-foreground">{reasonAction === "reject" ? t("kyc.action.rejectionReason") : t("kyc.action.informationRequested")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t("kyc.action.chooseReason")}</p>
                  <select
                    aria-label={t("kyc.accessibility.reason")}
                    value={reasonCode}
                    onChange={(event) => {
                      const next = event.target.value as KycReviewReasonCode | "";
                      setReasonCode(next);
                      if (next !== "other") setReasonDetail("");
                    }}
                    className={`${adminFilterControlClassName} mt-3 w-full`}
                  >
                    <option value="">{t("kyc.action.selectReason")}</option>
                    {KYC_REVIEW_REASON_CODES
                      .filter((code) => reasonAction === "reject" || code !== "document_suspected_tampering")
                      .map((code) => <option key={code} value={code}>{t(`kyc.reasons.${code}`)}</option>)}
                  </select>
                  {reasonCode === "other" && (
                    <textarea
                      aria-label={t("kyc.accessibility.details")}
                      rows={3}
                      value={reasonDetail}
                      onChange={(event) => setReasonDetail(event.target.value)}
                      placeholder={t("kyc.action.detailPlaceholder")}
                      className="mt-3 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  )}
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => { setReasonAction(null); setReasonCode(""); setReasonDetail(""); }}>{tCommon("actions.cancel")}</Button>
                    <Button size="sm" variant={reasonAction === "reject" ? "destructive" : "default"} disabled={busy || !canContinue} onClick={prepareReasonDecision}>{t("kyc.action.review")}</Button>
                  </div>
                </div>
              )}
            </section>
          ) : submission.status === "info_requested" ? (
            <section className="rounded-2xl border border-border bg-muted/50 p-5">
              <h2 className="font-semibold text-foreground">{t("kyc.detail.waitingTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("kyc.detail.waitingDescription")}</p>
            </section>
          ) : (
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-semibold text-foreground">{t("kyc.detail.outcome")}</h2>
              <p className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusClassName}`}>{statusLabel}</p>
              {reviewedAt && <p className="mt-3 text-sm text-muted-foreground">{t("kyc.detail.reviewedAt", { date: reviewedAt })}</p>}
              {submission.reviewedBy && <p className="mt-1 text-sm text-muted-foreground">{t("kyc.detail.reviewedBy", { reviewer: submission.reviewedBy })}</p>}
              {reasonLabel && <p className="mt-3 text-sm font-medium text-foreground">{reasonLabel}</p>}
              {submission.reviewReasonDetail && <p className="mt-1 text-sm text-muted-foreground">{submission.reviewReasonDetail}</p>}
              {!reviewedAt && <p className="mt-3 text-sm text-muted-foreground">{t("kyc.detail.readOnlyDescription")}</p>}
            </section>
          )}
        </aside>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">{t("kyc.detail.reviewHistory")}</h2>
        {detail.reviewEvents.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("kyc.detail.noReviewHistory")}</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {detail.reviewEvents.map((event) => (
              <li key={event.id} className="rounded-xl border border-border bg-secondary/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{t(`kyc.actions.${event.action}`)}</p>
                  <time className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</time>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{event.fromStatus} → {event.toStatus} · {event.actorRole}</p>
                {event.customerMessage && <p className="mt-2 text-sm text-foreground">{event.customerMessage}</p>}
                {event.internalNote && <p className="mt-1 text-xs text-muted-foreground">{event.internalNote}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <AdminConfirmDialog
        open={Boolean(confirmDecision) && actionable && confirmationVersion === detail.assignment.reviewVersion}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmLabel}
        confirmVariant={confirmDecision?.action === "reject" ? "destructive" : "default"}
        busy={busy}
        onCancel={() => setConfirmDecision(null)}
        onConfirm={submitConfirmedDecision}
      />
    </>
  );
}

export function KycReviewDetail({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const { t } = useTranslation("admin");
  const { showFeedback } = useActionFeedback();
  const [detail, setDetail] = useState<AdminKycReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [continueNext, setContinueNext] = useState(false);
  const workSequence = useRef(0);

  const [documentPreview, setDocumentPreview] = useState<{ side: "front" | "back"; url: string; pdf?: boolean; submissionId: string } | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const documentResource = useRef<{ url: string | null; request: AbortController | null; epoch: number }>({ url: null, request: null, epoch: 0 });
  const disposeDocument = useCallback(() => {
    const resource = documentResource.current;
    resource.epoch += 1;
    resource.request?.abort();
    resource.request = null;
    if (resource.url) URL.revokeObjectURL(resource.url);
    resource.url = null;
  }, []);
  const clearDocument = useCallback(() => {
    disposeDocument();
    setDocumentPreview(null);
    setDocumentLoading(false);
  }, [disposeDocument]);
  const handlePermissionFailure = useCallback((status: number, code?: string) => {
    if (status !== 401 && status !== 403 && code !== "KYC_MFA_REQUIRED") return false;
    clearDocument();
    setDetail(null);
    setRecording(false);
    router.replace(code === "KYC_MFA_REQUIRED" ? `/admin/kyc/mfa?next=${encodeURIComponent(`/admin/kyc/${submissionId}`)}` : "/admin/kyc");
    return true;
  }, [clearDocument, router, submissionId]);
  useEffect(() => {
    const hide = () => { if (document.visibilityState !== "visible") clearDocument(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", clearDocument);
    return () => {
      disposeDocument();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", clearDocument);
    };
  }, [submissionId, clearDocument, disposeDocument]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!signal) setLoading(true);
    try {
      const response = await fetch(`/api/admin/kyc/submissions/${submissionId}${signal ? "?refresh=1" : ""}`, { cache: "no-store", signal });
      const body = await response.json().catch(() => ({}));
      if (handlePermissionFailure(response.status, body?.error?.code)) { if (signal) throw Object.assign(new Error(t("reviewRefresh.denied")), { status: response.status }); return; }
      if (response.status === 404) {
        setNotFound(true);
        setDetail(null);
        setError(null);
        return;
      }
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? t("kyc.errors.loadSubmissions"));
      setDetail(body.data as AdminKycReviewDetail);
      setNotFound(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("kyc.errors.loadSubmissions"));
      if (signal) throw err;
    } finally {
      if (!signal) setLoading(false);
    }
  }, [submissionId, t, handlePermissionFailure]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const reviewRefresh = useVisibleReviewRefresh({ enabled: true, onRefresh: load });

  async function openDocument(side: "front" | "back") {
    if (!detail || detail.submission.id !== submissionId) return;
    clearDocument();
    const resource = documentResource.current;
    const epoch = resource.epoch;
    const controller = new AbortController();
    resource.request = controller;
    setDocumentLoading(true);
    try {
      const response = await fetch(`/api/admin/kyc/documents/${submissionId}/${side}`, { cache: "no-store", signal: controller.signal });
      if (epoch !== resource.epoch) return;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (handlePermissionFailure(response.status, body?.error?.code)) return;
        throw new Error(t("kyc.errors.loadDocument"));
      }
      if (response.headers.get("content-type")?.split(";")[0] === "application/pdf") {
        await response.body?.cancel();
        if (epoch !== resource.epoch || controller.signal.aborted) return;
        // Legacy PDFs retain a browser viewer via a fresh authenticated request.
        // The URL is this guarded API, never a Storage or signed URL.
        setDocumentPreview({ side, url: `/api/admin/kyc/documents/${submissionId}/${side}`, pdf: true, submissionId });
        return;
      }
      const blob = await response.blob();
      if (epoch !== resource.epoch || controller.signal.aborted) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(blob.type) || blob.size > 5 * 1024 * 1024) throw new Error(t("kyc.errors.loadDocument"));
      const url = URL.createObjectURL(blob);
      resource.url = url;
      setDocumentPreview({ side, url, submissionId });
    } catch {
      if (epoch !== resource.epoch || controller.signal.aborted) return;
      clearDocument();
      setError(t("kyc.errors.loadDocument"));
      showFeedback("error", t("kyc.errors.loadDocument"));
    } finally {
      if (epoch === resource.epoch) setDocumentLoading(false);
    }
  }

  async function review(decision: KycReviewDecision) {
    if (!detail || busy || detail.submission.status !== "pending") return;
    clearDocument();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/kyc/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: detail.submission.id,
          userId: detail.customer.id,
          expectedVersion: detail.assignment.reviewVersion,
          action: decision.action,
          ...(decision.reasonCode ? { reasonCode: decision.reasonCode } : {}),
          ...(decision.reasonDetail ? { reasonDetail: decision.reasonDetail } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (handlePermissionFailure(response.status, body?.error?.code)) return;
      if (response.status === 409) {
        // Refresh in place so the review form retains its draft after a conflict.
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 15_000);
        try { await load(controller.signal); }
        finally { window.clearTimeout(timeout); }
      }
      if (!response.ok) throw new Error(body.error?.message ?? t("kyc.errors.reviewFailed"));
      setRecording(false);
      await load();
      if (continueNext) await work("next");
      showFeedback(
        "success",
        decision.action === "approve"
          ? t("kyc.success.approved")
          : decision.action === "reject"
            ? t("kyc.success.rejected")
            : t("kyc.success.infoRequested"),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : t("kyc.errors.reviewFailed");
      setError(message);
      showFeedback("error", message);
    } finally {
      setBusy(false);
    }
  }

  async function work(action: "next" | "release" | "start" | "pause") {
    if (action === "next" || action === "release") clearDocument();
    setBusy(true);
    const sequence = ++workSequence.current;
    try {
      const response = await fetch("/api/admin/kyc/work", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "next" ? {} : { submissionId, expectedVersion: detail?.assignment.reviewVersion, ...(action === "pause" ? { sessionId } : {}) }) }) });
      const body = await response.json().catch(() => ({}));
      if (handlePermissionFailure(response.status, body?.error?.code)) return;
      if (!response.ok) throw new Error(t("kyc.operations.workFailed"));
      if (action === "next") router.push(body.data?.submissionId ? `/admin/kyc/${body.data.submissionId}` : "/admin/kyc");
      else if (action === "release") router.push("/admin/kyc");
      else if (sequence === workSequence.current) { setSessionId(body.data.sessionId ?? null); setRecording(action === "start"); }
    } catch { setError(t("kyc.operations.workFailed")); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!recording || !sessionId) return;
    const pause = () => {
      ++workSequence.current;
      setRecording(false);
      void fetch("/api/admin/kyc/work", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause", submissionId, sessionId, expectedVersion: detail?.assignment.reviewVersion }) }).then(async (response) => {
          if (response.status === 401 || response.status === 403) {
            const body = await response.json().catch(() => ({}));
            handlePermissionFailure(response.status, body?.error?.code);
            return;
          }
          if (!response.ok) setError(t("kyc.operations.recordingInterrupted"));
        }).catch(() => setError(t("kyc.operations.recordingInterrupted")));
    };
    const hide = () => { if (document.visibilityState !== "visible") pause(); };
    window.addEventListener("blur", pause);
    window.addEventListener("pagehide", pause);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", pause); window.removeEventListener("pagehide", pause);
      document.removeEventListener("visibilitychange", hide);
      // Closing/navigation may fail to reach the server. Unclosed intervals are
      // explicitly excluded from completed timing statistics.
      void fetch("/api/admin/kyc/work", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause", submissionId, sessionId, expectedVersion: detail?.assignment.reviewVersion }) }).catch(() => undefined);
    };
  }, [recording, sessionId, submissionId, detail?.assignment.reviewVersion, t, handlePermissionFailure]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("kyc.detail.loading")}</p>;
  }

  if (notFound) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <h1 className="text-xl font-semibold text-foreground">{t("kyc.detail.notFound")}</h1>
        <Link href="/admin/kyc" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"><ArrowLeft size={16} /> {t("kyc.detail.backToQueue")}</Link>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
        <p role="alert" className="text-sm text-destructive">{error ?? t("kyc.errors.loadSubmissions")}</p>
        <Button className="mt-4" variant="outline" onClick={() => void load()}>{t("kyc.detail.retry")}</Button>
      </div>
    );
  }

  return (
    <>
      <div className="col-span-full flex flex-wrap items-center gap-3 py-2 text-xs text-muted-foreground"><Button type="button" size="sm" variant="outline" onClick={reviewRefresh.refresh}>{t("actions.refresh")}</Button><span role="status">{reviewRefresh.hasRefreshError ? t("reviewRefresh.stale") : t("dashboard.lastRefreshed")} · {reviewRefresh.lastSuccessAt ? new Date(reviewRefresh.lastSuccessAt).toLocaleTimeString() : "—"}</span></div>
      <section className="mb-5 space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          {detail.assignment.isAssignedToCurrentUser && detail.submission.status === "pending" && <>
            <Button variant="outline" disabled={busy} onClick={() => void work(recording ? "pause" : "start")}>{t(recording ? "kyc.operations.pause" : "kyc.operations.start")}</Button>
          </>}
          {detail.assignment.canDecide && detail.submission.status === "pending" && <Button variant="outline" disabled={busy} onClick={() => void work("release")}>{t("kyc.operations.release")}</Button>}
          {detail.submission.status !== "pending" && <Button disabled={busy} onClick={() => void work("next")}>{t("kyc.operations.next")}</Button>}
        </div>
        <p role="status" className="text-xs text-muted-foreground">{t(recording ? "kyc.operations.recording" : "kyc.operations.notRecording")}</p>
        {detail.assignment.canDecide && detail.submission.status === "pending" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={continueNext} onChange={(event) => setContinueNext(event.target.checked)} />{t("kyc.operations.continueNext")}</label>}
      </section>
      <KycReviewDetailContent
      detail={detail}
      documentPreview={documentPreview?.submissionId === submissionId ? documentPreview : null}
      documentLoading={documentLoading}
      onCloseDocument={clearDocument}
      busy={busy}
      error={error}
      onOpenDocument={(side) => { void openDocument(side); }}
      onDecision={(decision) => { void review(decision); }}
      />
    </>
  );
}
