"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { KycSecurityStatus } from "@/lib/kyc/types";
import { Clock3, FileCheck2, Search, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AdminKycSubmission, User } from "@/backend/core/types";
import { AdminFilterBar, adminFilterControlClassName } from "@/components/admin/filter-bar";
import { KycReviewQueueRow } from "@/components/admin/kyc-review-queue-row";
import { AdminMetricGrid, AdminPageHeader, AdminPageShell } from "@/components/admin/admin-page-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/lib/i18n/locale";

function dateLabel(value: string | null | undefined, locale: AppLocale) {
  return value ? new Date(value).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

export default function AdminKycPage() {
  const { t, i18n } = useTranslation("admin");
  const { t: tCommon } = useTranslation("common");
  const router = useRouter();
  const [security, setSecurity] = useState<KycSecurityStatus | null>(null);
  const [securityError, setSecurityError] = useState(false);
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  const [users, setUsers] = useState<User[]>([]);
  const [submissions, setSubmissions] = useState<Map<string, AdminKycSubmission>>(new Map());
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "info_requested">("all");

  async function load() {
    try {
      const response = await fetch("/api/admin/kyc/submissions", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (body.error?.code === "KYC_MFA_REQUIRED") {
        setUsers([]);
        setSubmissions(new Map());
        setSecurity(null);
        router.replace("/admin/kyc/mfa?next=%2Fadmin%2Fkyc");
        return;
      }
      if (!response.ok) throw new Error(body.error?.message ?? t("kyc.errors.loadSubmissions"));
      setUsers((body.data?.customers ?? []).map((customer: Pick<User, "id" | "name" | "email" | "verificationTier">) => ({
        ...customer,
        role: "customer" as const,
        avatarInitial: customer.name.charAt(0).toUpperCase() || "?",
      })));
      setSubmissions(new Map((body.data?.submissions ?? []).map((submission: AdminKycSubmission) => [submission.userId, submission])));
      setVerifiedCount(body.data?.verifiedCount ?? 0);
      setError(null);
      try {
        const statusResponse = await fetch("/api/admin/kyc/security-status", { cache: "no-store" });
        const statusBody = await statusResponse.json();
        if (!statusResponse.ok || !statusBody.data) throw new Error();
        setSecurity(statusBody.data as KycSecurityStatus);
        setSecurityError(false);
      } catch { setSecurityError(true); }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("kyc.errors.loadQueue"));
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  const queueUsers = users.filter((user) => submissions.has(user.id));
  const pendingReview = queueUsers.filter((user) => submissions.get(user.id)?.status === "pending");
  const infoRequested = queueUsers.filter((user) => submissions.get(user.id)?.status === "info_requested");
  const oldestPendingAt = pendingReview
    .map((user) => submissions.get(user.id)?.submittedAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const visibleQueue = queueUsers.filter((user) => {
    const submission = submissions.get(user.id);
    const matchesStatus = statusFilter === "all" || submission?.status === statusFilter;
    const searchText = `${user.name} ${user.email} ${submission?.docType ?? ""}`.toLowerCase();
    return matchesStatus && (!search.trim() || searchText.includes(search.trim().toLowerCase()));
  });
  return (
    <AdminPageShell>
      <AdminPageHeader
        eyebrow={<><ShieldCheck size={18} /> {t("kyc.eyebrow")}</>}
        title={t("kyc.title")}
        description={t("kyc.description")}
      />
      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">{t("kyc.security.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("kyc.security.description")}</p>
        {securityError && <p role="alert" className="text-sm text-destructive">{t("kyc.security.unavailable")}</p>}
        {security && <>
          {security.emailRecipients === 0 && <p role="alert" className="text-sm text-destructive">{t("kyc.security.noEmailRecipients")}</p>}
          <p className="text-sm">{t("kyc.security.run", { status: t(`kyc.security.status.${security.latestRun?.status ?? "none"}`) })}</p>
          {security.latestRun && <p className="text-sm text-muted-foreground">{t("kyc.security.counts", { claimed: security.latestRun.claimed, purged: security.latestRun.purged, failed: security.latestRun.failed })} · {new Date(security.latestRun.startedAt).toLocaleString(locale)}</p>}
          <p className="text-sm text-muted-foreground">{t("kyc.security.checked", { time: security.monitor.lastCheckedAt ? new Date(security.monitor.lastCheckedAt).toLocaleString(locale) : t("kyc.security.notChecked") })}</p>
          {security.pendingAlerts > 0 && <p role="alert" className="text-sm text-destructive">{t("kyc.security.pending", { count: security.pendingAlerts })}</p>}
          {security.incidents.length > 0 && <ul className="space-y-2 border-t border-border pt-3">
            {security.incidents.map((incident, index) => <li key={`${incident.occurredAt}-${index}`} className="text-sm">
              <p>{tCommon(`notifications.events.kycSecurity.${incident.kind}`, { count: incident.count })}</p>
              <p className="text-xs text-muted-foreground">{new Date(incident.occurredAt).toLocaleString(locale)} · {t(incident.deliveryQueued ? "kyc.security.queued" : "kyc.security.notQueued")}{incident.resolvedAt ? ` · ${t("kyc.security.resolved")}` : ""}</p>
            </li>)}
          </ul>}
        </>}
      </section>

      <AdminMetricGrid items={[
        { label: t("kyc.metrics.pending"), value: pendingReview.length, detail: t("kyc.metrics.pendingNote") },
        { label: t("kyc.metrics.infoRequested"), value: infoRequested.length, detail: t("kyc.metrics.infoRequestedNote") },
        { label: t("kyc.metrics.verified"), value: verifiedCount, detail: t("kyc.metrics.verifiedNote") },
        { label: t("kyc.metrics.oldest"), value: oldestPendingAt ? dateLabel(oldestPendingAt, locale) : "—", detail: oldestPendingAt ? t("kyc.metrics.submittedFirst") : t("kyc.metrics.queueClear") },
      ]} />

      <AdminFilterBar>
        <label className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("kyc.filters.search")} aria-label={t("kyc.filters.search")} className={`${adminFilterControlClassName} w-full pl-9`} />
        </label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "pending" | "info_requested")} aria-label={t("kyc.filters.status")} className={adminFilterControlClassName}>
          <option value="all">{t("kyc.filters.allStatuses")}</option>
          <option value="pending">{t("kyc.status.pending")}</option>
          <option value="info_requested">{t("kyc.filters.infoRequestedCount", { count: infoRequested.length })}</option>
        </select>
      </AdminFilterBar>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="font-semibold text-foreground">{t("kyc.queue.title")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("kyc.queue.description")}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 size={14} /> {t("kyc.queue.oldestFirst")}</div>
        </div>
        {visibleQueue.length === 0 ? (
          <EmptyState icon={<FileCheck2 size={28} />} title={t("kyc.empty.title")} description={t("kyc.empty.description")} />
        ) : (
          <div className="divide-y divide-border">
            {visibleQueue.map((user) => {
              const submission = submissions.get(user.id);
              if (!submission) return null;
              return (
                <KycReviewQueueRow
                  key={user.id}
                  user={user}
                  submission={submission}
                  documentLabel={t(`kyc.documents.${submission.docType}`)}
                  statusLabel={t(`kyc.status.${submission.status === "info_requested" ? "infoRequested" : "pending"}`)}
                  submittedLabel={t("kyc.submitted", { date: dateLabel(submission.submittedAt, locale), position: submission.queuePosition ?? "—" })}
                  reviewLabel={t("kyc.detail.review")}
                  href={`/admin/kyc/${submission.id}`}
                />
              );
            })}
          </div>
        )}
      </section>

    </AdminPageShell>
  );
}
