"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** Local-only preview. No upload, quality verdict, persistence or OCR. */
export function KycPhotoPreview({ file, label }: { file: File | null; label: string }) {
  const { t } = useTranslation("customer");
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    // The URL is created after mount and belongs to this exact File only.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview({ file, url });
    setFailed(false);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (!file || preview?.file !== file) return null;
  return <div className="space-y-2 rounded-xl border border-border bg-card p-3">
    {/* Local blobs must never go through an image proxy or optimizer. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={preview.url} alt={t("ui.kyc.previewAlt", { side: label })} onError={() => setFailed(true)} className="max-h-64 w-full rounded-lg object-contain" />
    <p className="text-sm text-muted-foreground">{t("ui.kyc.previewGuidance")}</p>
    {failed && <p role="status" className="text-sm text-muted-foreground">{t("ui.kyc.previewUnavailable")}</p>}
  </div>;
}
