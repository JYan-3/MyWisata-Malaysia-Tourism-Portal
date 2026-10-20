"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink, LifeBuoy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AdminPageHeader, AdminPageShell } from "@/components/admin/admin-page-shell";
import { findGuide, sectionAudience, sectionTitle, useStaffHelpSections } from "../staff-help-sections";

// One Staff Help guide. Shown only when the guide is visible to this staff
// member under the same rule as the list page.

export default function AdminHelpGuidePage() {
  const { t } = useTranslation("admin");
  const params = useParams<{ slug: string }>();
  const { isSuperAdmin, visible } = useStaffHelpSections();
  const guide = findGuide(params.slug ?? "");
  const available = guide && visible.some((capability) => capability.name === guide.name);

  const back = (
    <Link href="/admin/help" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
      <ArrowLeft size={14} aria-hidden="true" /> {t("staffHelp.backToHelp")}
    </Link>
  );

  if (!guide || !available) {
    return (
      <AdminPageShell>
        {back}
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">{t("staffHelp.notAvailable")}</p>
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell>
      {back}
      <AdminPageHeader
        eyebrow={<><LifeBuoy size={12} aria-hidden="true" /> {t("staffHelp.eyebrow")}</>}
        title={sectionTitle(guide)}
        description={guide.description}
        actions={(
          <Link href={guide.path} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground">
            {t("staffHelp.openPage")} <ExternalLink size={13} aria-hidden="true" />
          </Link>
        )}
      />

      <div data-staff-help-guide={guide.name} className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-secondary px-2.5 py-1 font-semibold text-secondary-foreground">
            {sectionAudience(guide, isSuperAdmin) === "granted" ? t("staffHelp.whoGranted") : sectionAudience(guide, isSuperAdmin) === "superAdmin" ? t("staffHelp.whoSuperAdmin") : t("staffHelp.whoStaff")}
          </span>
          <span className="font-mono">{guide.path}</span>
        </div>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("staffHelp.actions")}</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-foreground">
            {guide.actions.map((action) => <li key={action}>{action}</li>)}
          </ul>
        </div>
        {guide.notes && guide.notes.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("staffHelp.notes")}</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              {guide.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("staffHelp.contentLanguage")}</p>
      </div>
    </AdminPageShell>
  );
}
