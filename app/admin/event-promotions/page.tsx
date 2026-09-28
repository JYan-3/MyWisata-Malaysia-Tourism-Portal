"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Megaphone, Save, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AdminFilterBar, adminFilterControlClassName } from "@/components/admin/filter-bar";
import { AdminMetricGrid, AdminPageHeader, AdminPageShell } from "@/components/admin/admin-page-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActionFeedback } from "@/components/providers/action-feedback";

interface AdminEventPromotion {
  id: string;
  vendorId: string;
  vendorName: string;
  title: string;
  startDate: string;
  endDate: string;
  status: "pending" | "approved" | "paid" | "rejected" | "changes_requested" | "paused";
  createdAt: string;
}

type StatusFilter = "all" | AdminEventPromotion["status"];

export default function AdminEventPromotionsPage() {
  const { t } = useTranslation("admin");
  const { showFeedback } = useActionFeedback();
  const [promotions, setPromotions] = useState<AdminEventPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [costPerDayRm, setCostPerDayRm] = useState("100");
  const [maxConcurrent, setMaxConcurrent] = useState("4");
  const [savingCost, setSavingCost] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/event-promotions", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message ?? t("eventPromotions.errors.load"));
      setPromotions(body.data?.promotions ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("eventPromotions.errors.load"));
    } finally {
      setLoading(false);
    }
  }

  async function loadSettings() {
    try {
      const response = await fetch("/api/admin/event-promotion-settings", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (response.ok && typeof body.data?.costPerDaySen === "number") {
        setCostPerDayRm((body.data.costPerDaySen / 100).toString());
      }
      if (response.ok && typeof body.data?.maxConcurrent === "number") {
        setMaxConcurrent(body.data.maxConcurrent.toString());
      }
    } catch {
      // Keep the defaults (RM100/day, 4 concurrent) on failure.
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); void loadSettings(); }, []);

  async function saveSettings() {
    const rm = Number(costPerDayRm);
    const cap = Number(maxConcurrent);
    if (!Number.isFinite(rm) || rm < 0 || !Number.isInteger(cap) || cap < 1) {
      showFeedback("error", t("eventPromotions.settings.invalid"));
      return;
    }
    setSavingCost(true);
    try {
      const response = await fetch("/api/admin/event-promotion-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costPerDaySen: Math.round(rm * 100), maxConcurrent: cap }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message ?? t("eventPromotions.settings.saveError"));
      showFeedback("success", t("eventPromotions.settings.saved"));
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : t("eventPromotions.settings.saveError"));
    } finally {
      setSavingCost(false);
    }
  }

  const pending = promotions.filter((p) => p.status === "pending");
  const changesRequested = promotions.filter((p) => p.status === "changes_requested");
  const approved = promotions.filter((p) => p.status === "approved");
  const paid = promotions.filter((p) => p.status === "paid");
  const visible = promotions.filter((promotion) => {
    const matchesStatus = statusFilter === "all" || promotion.status === statusFilter;
    const searchText = `${promotion.title} ${promotion.vendorName}`.toLowerCase();
    return matchesStatus && (!search.trim() || searchText.includes(search.trim().toLowerCase()));
  });

  return (
    <AdminPageShell>
      <AdminPageHeader
        eyebrow={<><Megaphone size={18} /> {t("eventPromotions.eyebrow")}</>}
        title={t("eventPromotions.title")}
        description={t("eventPromotions.description")}
      />
      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label htmlFor="event-promotion-cost-per-day" className="min-w-[200px] flex-1">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t("eventPromotions.settings.costPerDay")}</span>
          <span className="relative block max-w-[160px]">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">{t("eventPromotions.settings.currencyPrefix")}</span>
            <input
              id="event-promotion-cost-per-day"
              type="number"
              min={0}
              step={0.01}
              value={costPerDayRm}
              onChange={(event) => setCostPerDayRm(event.target.value)}
              className={`${adminFilterControlClassName} w-full pl-9`}
            />
          </span>
        </label>
        <label htmlFor="event-promotion-max-concurrent" className="min-w-[200px] flex-1">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t("eventPromotions.settings.maxConcurrent")}</span>
          <input
            id="event-promotion-max-concurrent"
            type="number"
            min={1}
            step={1}
            value={maxConcurrent}
            onChange={(event) => setMaxConcurrent(event.target.value)}
            className={`${adminFilterControlClassName} w-full max-w-[160px]`}
          />
        </label>
        <Button type="button" size="sm" disabled={savingCost} onClick={() => void saveSettings()}>
          <Save size={14} aria-hidden="true" /> {t("eventPromotions.settings.save")}
        </Button>
      </section>

      <AdminMetricGrid items={[
        { label: t("eventPromotions.metrics.pending"), value: pending.length },
        { label: t("eventPromotions.metrics.changesRequested"), value: changesRequested.length },
        { label: t("eventPromotions.metrics.approved"), value: approved.length },
        { label: t("eventPromotions.metrics.paid"), value: paid.length },
        { label: t("eventPromotions.metrics.total"), value: promotions.length },
      ]} />

      <AdminFilterBar>
        <label className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("eventPromotions.filters.search")} aria-label={t("eventPromotions.filters.search")} className={`${adminFilterControlClassName} w-full pl-9`} />
        </label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} aria-label={t("eventPromotions.filters.status")} className={adminFilterControlClassName}>
          <option value="all">{t("eventPromotions.filters.allStatuses")}</option>
          <option value="pending">{t("eventPromotions.status.pending")}</option>
          <option value="changes_requested">{t("eventPromotions.status.changesRequested")}</option>
          <option value="approved">{t("eventPromotions.status.approved")}</option>
          <option value="paid">{t("eventPromotions.status.paid")}</option>
          <option value="paused">{t("eventPromotions.status.paused")}</option>
          <option value="rejected">{t("eventPromotions.status.rejected")}</option>
        </select>
      </AdminFilterBar>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        {loading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{t("eventPromotions.loading")}</p>
        ) : visible.length === 0 ? (
          <EmptyState icon={<Megaphone size={28} />} title={t("eventPromotions.empty.title")} description={t("eventPromotions.empty.description")} />
        ) : (
          <div className="divide-y divide-border">
            {visible.map((promotion) => (
              <Link
                key={promotion.id}
                href={`/admin/event-promotions/${promotion.id}`}
                className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-secondary/40"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{promotion.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {promotion.vendorName} · {promotion.startDate === promotion.endDate ? promotion.startDate : `${promotion.startDate} – ${promotion.endDate}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge status={promotion.status} />
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
