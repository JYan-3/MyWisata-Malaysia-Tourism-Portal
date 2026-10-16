"use client";

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { requestContentTranslation } from '@/lib/content-translations/client-batcher';
import { DEFAULT_LOCALE, isAppLocale } from '@/lib/i18n/locale';
import type { PublicTranslationEntity, PublicTranslationField } from '@/lib/content-translations/contract';

type Props = {
  entityType: PublicTranslationEntity;
  entityId: string;
  field: PublicTranslationField;
  sourceText: string;
  className?: string;
  as?: 'span' | 'p';
  children?: (value: { text: string; control: ReactNode; pending: boolean }) => ReactNode;
};

export function LocalizedContent({ entityType, entityId, field, sourceText, className, as = 'span', children }: Props) {
  const { t, i18n } = useTranslation('customer');
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  const lookupKey = `${entityType}:${entityId}:${field}:${locale}:${sourceText}`;
  const [translation, setTranslation] = useState<{ key: string; translatedText: string | null; pending: boolean } | null>(null);
  const [showOriginalKey, setShowOriginalKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void requestContentTranslation(entityType, entityId, field, locale).then((result) => {
      if (active) setTranslation({ key: lookupKey, ...result });
    });
    return () => { active = false; };
  }, [entityType, entityId, field, locale, lookupKey]);

  const currentTranslation = translation?.key === lookupKey ? translation : null;
  const showOriginal = showOriginalKey === lookupKey;
  const hasTranslation = Boolean(currentTranslation?.translatedText);
  const text = hasTranslation && !showOriginal ? currentTranslation!.translatedText! : sourceText;
  const control = hasTranslation ? (
    <>
      {!showOriginal && <span className="ml-1 text-[10px] text-muted-foreground">{t('ui.contentTranslation.machineTranslated')}</span>}{' '}
      <button type="button" onClick={() => setShowOriginalKey((key) => key === lookupKey ? null : lookupKey)} className="ml-1 inline text-[11px] font-semibold text-primary underline underline-offset-2 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        {t(showOriginal ? 'ui.contentTranslation.showTranslation' : 'ui.contentTranslation.showOriginal')}
      </button>
    </>
  ) : currentTranslation?.pending ? (
    <span role="status" aria-live="polite" className="ml-1 text-[10px] text-muted-foreground">{t('ui.contentTranslation.pending')}</span>
  ) : null;

  if (children) return children({ text, control, pending: Boolean(currentTranslation?.pending && !hasTranslation) });
  const Tag = as;
  return <Tag className={className}>{text}{control}</Tag>;
}
