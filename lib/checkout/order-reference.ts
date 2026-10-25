export type ParsedOrderReference = { kind: 'id' | 'displayId'; value: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISPLAY_ID = /^ORD-[A-Z0-9-]{1,16}$/;

export function parseOrderReference(value: string): ParsedOrderReference | null {
  const raw = value.trim().replace(/^#\s*/, '');
  if (UUID.test(raw)) return { kind: 'id', value: raw.toLowerCase() };
  const displayId = raw.toUpperCase();
  return displayId.length <= 20 && DISPLAY_ID.test(displayId)
    ? { kind: 'displayId', value: displayId }
    : null;
}

export function formatOrderReference(id: string, displayId?: string | null): string {
  return displayId?.trim() || id;
}
