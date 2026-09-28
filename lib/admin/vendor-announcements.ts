// Vendor-Fair Event Participation — admin-side announcement authoring.
// See Docs/plans/2026-09-28-1732-vendor-fair-event-participation.md.
// Writes go through the service client (same precedent as platform_settings /
// event-promotion cost-per-day) — no RLS INSERT policy, the staff-gated API
// route is the only write path.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AdminVendorAnnouncement {
  id: string;
  title: string;
  body: string;
  senderCode: string;
  campaignId: string | null;
  createdAt: string;
}

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  sender_code: string;
  campaign_id: string | null;
  created_at: string;
};

function toAnnouncement(row: AnnouncementRow): AdminVendorAnnouncement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    senderCode: row.sender_code,
    campaignId: row.campaign_id,
    createdAt: row.created_at,
  };
}

const COLUMNS = 'id,title,body,sender_code,campaign_id,created_at';

export async function listVendorAnnouncements(db: SupabaseClient): Promise<AdminVendorAnnouncement[]> {
  const { data, error } = await db.from('vendor_announcements').select(COLUMNS).order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load announcements: ${error.message}`);
  return (data ?? []).map((row) => toAnnouncement(row as AnnouncementRow));
}

export async function createVendorAnnouncement(
  db: SupabaseClient,
  input: { title: string; body: string; senderCode: string; campaignId: string | null },
  createdBy: string,
): Promise<AdminVendorAnnouncement> {
  const { data, error } = await db.from('vendor_announcements').insert({
    title: input.title,
    body: input.body,
    sender_code: input.senderCode,
    campaign_id: input.campaignId,
    created_by: createdBy,
  }).select(COLUMNS).single();
  if (error) throw new Error(`Failed to create announcement: ${error.message}`);
  return toAnnouncement(data as AnnouncementRow);
}
