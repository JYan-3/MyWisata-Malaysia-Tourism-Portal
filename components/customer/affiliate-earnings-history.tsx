"use client";

import { useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useActionFeedback } from "@/components/providers/action-feedback";
import { useCustomerCapabilityGate } from "@/components/customer/use-customer-capability-gate";
import { rangeCutoffIso, type EarningsExportRange } from "@/lib/affiliate/earnings-range";
import type { AffiliateCommission } from "@/lib/affiliate/stats";
import { formatMYR } from "@/lib/i18n/format";

/**
 * Affiliate earnings history with a period filter and CSV download. The period
 * filters the list and the download alike. With `limit` + `viewAllHref` it is the
 * dashboard's short version: the newest `limit` rows and a link to the full page.
 */
export function AffiliateEarningsHistory({
  commissions,
  returnPath,
  limit,
  viewAllHref,
}: {
  commissions: AffiliateCommission[];
  /** Where the capability gate sends the user back to after verifying. */
  returnPath: string;
  limit?: number;
  viewAllHref?: string;
}) {
  const { t: tCustomer } = useTranslation("customer");
  const gate = useCustomerCapabilityGate();
  const { showFeedback } = useActionFeedback();
  const [range, setRange] = useState<EarningsExportRange>("all");
  const [exporting, setExporting] = useState(false);

  // `commissions` arrive newest first (lib/affiliate/stats.ts), so a slice is "the latest N".
  const cutoff = rangeCutoffIso(range);
  const inRange = cutoff ? commissions.filter((c) => Date.parse(c.createdAt) >= Date.parse(cutoff)) : commissions;
  const shown = limit ? inRange.slice(0, limit) : inRange;

  async function downloadEarnings() {
    if (exporting) return;
    if (!gate("affiliate.earn_commission", returnPath)) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/affiliate/earnings-export?range=${range}`);
      if (await gate.handleResponse(res, returnPath)) return;
      if (!res.ok) {
        showFeedback("error", tCustomer("strictMigration.affiliate.earnings.exportFailed"));
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "mylawatan-affiliate-earnings.csv";
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      showFeedback("error", tCustomer("strictMigration.affiliate.earnings.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_8px_24px_rgba(1,0,102,0.06)]">
      <div className="px-4 py-2.5 bg-muted flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{tCustomer("strictMigration.affiliate.earningsHistory")}</p>
        {viewAllHref && (
          <Button asChild size="sm" variant="outline" className="h-7 text-[0.6875rem] px-2">
            <Link href={viewAllHref}>{tCustomer("strictMigration.affiliate.earnings.viewAll")}</Link>
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <p className="text-[0.6875rem] text-muted-foreground">
          {limit && inRange.length > limit ? tCustomer("strictMigration.affiliate.earnings.latest", { shown: limit, total: inRange.length }) : null}
        </p>
        <div className="flex items-center gap-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as EarningsExportRange)}
            aria-label={tCustomer("strictMigration.affiliate.earnings.period")}
            className="h-7 rounded-lg border border-border px-2 text-[0.6875rem] bg-background text-foreground"
          >
            <option value="month">{tCustomer("strictMigration.affiliate.thisMonth")}</option>
            <option value="year">{tCustomer("strictMigration.affiliate.thisYear")}</option>
            <option value="all">{tCustomer("strictMigration.affiliate.allTime")}</option>
          </select>
          <Button size="sm" variant="outline" className="h-7 text-[0.6875rem] px-2" onClick={downloadEarnings} disabled={exporting}>
            <Download size={12} /> {exporting ? tCustomer("strictMigration.affiliate.earnings.exporting") : tCustomer("strictMigration.affiliate.earnings.download")}
          </Button>
        </div>
      </div>
      <div className="divide-y divide-border">
        {shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {commissions.length === 0 ? tCustomer("strictMigration.affiliate.noCommissions") : tCustomer("strictMigration.affiliate.earnings.noneInRange")}
          </p>
        ) : (
          shown.map((c) => (
            <div key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words whitespace-normal text-sm font-medium text-foreground">{c.productName ?? tCustomer("strictMigration.affiliate.earnings.referral")}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(c.createdAt).toLocaleDateString()}
                  {c.orderAmount !== null && ` · ${tCustomer("strictMigration.affiliate.earnings.order", { amount: formatMYR(c.orderAmount) })}`} · {tCustomer("strictMigration.affiliate.rate", { percent: (c.rate * 100).toFixed(0) })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.status === "confirmed" && tCustomer("strictMigration.affiliate.earnings.cleared")}
                  {c.status === "pending" &&
                    (c.clearsInDays === 0 ? tCustomer("strictMigration.affiliate.earnings.pendingToday") : tCustomer("strictMigration.affiliate.earnings.pendingIn", { count: c.clearsInDays ?? 0 }))}
                  {c.status === "reversed" && tCustomer("strictMigration.affiliate.earnings.reversed")}
                  {c.status === "rejected" && tCustomer("strictMigration.affiliate.earnings.rejected")}
                </p>
              </div>
              <p
                className={`shrink-0 font-bold font-[family-name:var(--font-mono)] ${c.status === "reversed" || c.status === "rejected" ? "text-muted-foreground line-through" : "text-foreground"}`}
              >
                {formatMYR(c.amount)}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
