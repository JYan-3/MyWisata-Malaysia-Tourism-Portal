import {
  translationResultKey,
  type PublicTranslationEntity,
  type PublicTranslationField,
  type PublicTranslationResult,
  type SupportedTranslationLocale,
} from './contract';

type LookupResult = Pick<PublicTranslationResult, 'translatedText' | 'pending'>;
type TranslationFetcher = (input: string, init: RequestInit) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;
type PendingLookup = {
  entityType: PublicTranslationEntity;
  entityId: string;
  field: PublicTranslationField;
  locale: SupportedTranslationLocale;
  resolve: (result: LookupResult) => void;
};
type GroupedLookup = {
  entityType: PublicTranslationEntity;
  entityId: string;
  fields: Set<PublicTranslationField>;
  lookups: PendingLookup[];
};

type TranslationEnvelope = {
  data?: { translations?: unknown } | null;
};

export function createContentTranslationBatcher(fetcher: TranslationFetcher = fetch) {
  let pending: PendingLookup[] = [];
  let flushScheduled = false;

  function flush() {
    flushScheduled = false;
    const batch = pending;
    pending = [];
    const byLocale = new Map<SupportedTranslationLocale, PendingLookup[]>();
    for (const lookup of batch) {
      const group = byLocale.get(lookup.locale) ?? [];
      group.push(lookup);
      byLocale.set(lookup.locale, group);
    }

    for (const [locale, lookups] of byLocale) {
      void sendBatch(locale, lookups);
    }
  }

  async function sendBatch(locale: SupportedTranslationLocale, lookups: PendingLookup[]) {
    const groupedItems = new Map<string, GroupedLookup>();
    for (const lookup of lookups) {
      const itemKey = `${lookup.entityType}:${lookup.entityId}`;
      const item = groupedItems.get(itemKey) ?? {
        entityType: lookup.entityType,
        entityId: lookup.entityId,
        fields: new Set<PublicTranslationField>(),
        lookups: [],
      };
      item.fields.add(lookup.field);
      item.lookups.push(lookup);
      groupedItems.set(itemKey, item);
    }

    const chunks: GroupedLookup[][] = [];
    let chunk: GroupedLookup[] = [];
    let chunkFieldCount = 0;
    for (const item of groupedItems.values()) {
      if (chunk.length >= 40 || chunkFieldCount + item.fields.size > 80) {
        chunks.push(chunk);
        chunk = [];
        chunkFieldCount = 0;
      }
      chunk.push(item);
      chunkFieldCount += item.fields.size;
    }
    if (chunk.length > 0) chunks.push(chunk);

    await Promise.all(chunks.map(async (itemGroups) => {
      const chunkLookups = itemGroups.flatMap((item) => item.lookups);
      try {
        const response = await fetcher('/api/customer/content-translations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locale,
            items: itemGroups.map((item) => ({
              entityType: item.entityType,
              entityId: item.entityId,
              fields: [...item.fields],
            })),
          }),
        });
        if (!response.ok) throw new Error('translation_read_unavailable');
        const payload = await response.json() as TranslationEnvelope;
        const translations = Array.isArray(payload.data?.translations)
          ? payload.data.translations as PublicTranslationResult[]
          : [];
        const byKey = new Map(translations.map((translation) => [
          translationResultKey(translation.entityType, translation.entityId, translation.field),
          { translatedText: translation.translatedText, pending: Boolean(translation.pending) },
        ]));

        for (const lookup of chunkLookups) {
          lookup.resolve(byKey.get(translationResultKey(lookup.entityType, lookup.entityId, lookup.field)) ?? {
            translatedText: null,
            pending: false,
          });
        }
      } catch {
        for (const lookup of chunkLookups) lookup.resolve({ translatedText: null, pending: false });
      }
    }));
  }

  return {
    lookup(
      entityType: PublicTranslationEntity,
      entityId: string,
      field: PublicTranslationField,
      locale: SupportedTranslationLocale,
    ): Promise<LookupResult> {
      return new Promise((resolve) => {
        pending.push({ entityType, entityId, field, locale, resolve });
        if (!flushScheduled) {
          flushScheduled = true;
          queueMicrotask(flush);
        }
      });
    },
  };
}

const contentTranslationBatcher = createContentTranslationBatcher();

export function requestContentTranslation(
  entityType: PublicTranslationEntity,
  entityId: string,
  field: PublicTranslationField,
  locale: SupportedTranslationLocale,
) {
  return contentTranslationBatcher.lookup(entityType, entityId, field, locale);
}
