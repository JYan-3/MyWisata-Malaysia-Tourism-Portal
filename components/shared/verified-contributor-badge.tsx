"use client";

import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

/**
 * Public, boolean-only KYC indicator. Keeping the input intentionally narrow
 * prevents callers from coupling public UI to internal KYC status or metadata.
 */
export function VerifiedContributorBadge({ verified }: { verified: boolean }) {
  const { t } = useTranslation("common");
  if (!verified) return null;

  const label = t("strictMigration.verifiedContributor");

  return (
    <Badge
      variant="outline"
      role="img"
      aria-label={label}
      title={label}
      className="gap-1 border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
    >
      <CheckCircle2 aria-hidden="true" />
      <span>{label}</span>
    </Badge>
  );
}
