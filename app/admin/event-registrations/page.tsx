"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, ClipboardCheck, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AdminFilterBar, adminFilterControlClassName } from "@/components/admin/filter-bar";
import { AdminMetricGrid, AdminPageHeader, AdminPageShell } from "@/components/admin/admin-page-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/ui/badge";

interface AdminCampaignRegistration {
  id: string;
  campaignId: string;
  campaignTitle: string;
  vendorId: string;
  vendorName: string;
  stallNumber: string;
  status: "pending" | "approved" | "rejected" | "changes_requested";
  createdAt: string;
}

type StatusFilter = "all" | AdminCampaignRegistration["status"];

export default function EventRegistrationsPage() {
  const { t } = useTranslation("admin");
  const [registrations, setRegistrations] = useState<AdminCampaignRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/event-registrations", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message ?? t("eventRegistrations.errors.load"));
      setRegistrations(body.data?.registrations ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("eventRegistrations.errors.load"));
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  const pending = registrations.filter((r) => r.status === "pending");
  const changesRequested = registrations.filter((r) => r.status === "changes_requested");
  const approved = registrations.filter((r) => r.status === "approved");
  const visible = registrations.filter((registration) => {
    const matchesStatus = statusFilter === "all" || registration.status === statusFilter;
    const searchText = `${registration.vendorName} ${registration.campaignTitle} ${registration.stallNumber}`.toLowerCase();
    return matchesStatus && (!search.trim() || searchText.includes(search.trim().toLowerCase()));
  });

  return (
    <AdminPageShell>
      <AdminPageHeader
        eyebrow={<><ClipboardCheck size={18} /> {t("eventRegistrations.eyebrow")}</>}
        title={t("eventRegistrations.title")}
        description={t("eventRegistrations.description")}
      />
      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      <AdminMetricGrid items={[
        { label: t("eventRegistrations.metrics.pending"), value: pending.length },
        { label: t("eventRegistrations.metrics.changesRequested"), value: changesRequested.length },
        { label: t("eventRegistrations.metrics.approved"), value: approved.length },
        { label: t("eventRegistrations.metrics.total"), value: registrations.length },
      ]} />

      <AdminFilterBar>
        <label className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("eventRegistrations.filters.search")} aria-label={t("eventRegistrations.filters.search")} className={`${adminFilterControlClassName} w-full pl-9`} />
        </label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} aria-label={t("eventRegistrations.filters.status")} className={adminFilterControlClassName}>
          <option value="all">{t("eventRegistrations.filters.allStatuses")}</option>
          <option value="pending">{t("eventRegistrations.status.pending")}</option>
          <option value="changes_requested">{t("eventRegistrations.status.changesRequested")}</option>
          <option value="approved">{t("eventRegistrations.status.approved")}</option>
          <option value="rejected">{t("eventRegistrations.status.rejected")}</option>
        </select>
      </AdminFilterBar>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        {loading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{t("eventRegistrations.loading")}</p>
        ) : visible.length === 0 ? (
          <EmptyState icon={<ClipboardCheck size={28} />} title={t("eventRegistrations.empty.title")} description={t("eventRegistrations.empty.description")} />
        ) : (
          <div className="divide-y divide-border">
            {visible.map((registration) => (
              <Link
                key={registration.id}
                href={`/admin/event-registrations/${registration.id}`}
                className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-secondary/40"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{registration.vendorName}</p>
                  <p className="text-xs text-muted-foreground">{registration.campaignTitle} · {t("eventRegistrations.stallLabel", { number: registration.stallNumber })}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge status={registration.status} />
                  <ChevronRight size={16} className="text-muted-foreground" aria-hidden="true" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </AdminPageShell>
  );
}
