import type { SupabaseClient } from "@supabase/supabase-js";

export const ACCOMMODATION_CATEGORY_ID = "11111111-0000-0000-0000-000000000008";

/** True when the outlet sells at least one active room, directly or through an active offer (D14 of the hotel plan). */
export async function isHotelOutlet(db: SupabaseClient, outletId: string): Promise<boolean> {
  const [direct, offered] = await Promise.all([
    db.from("products").select("id").eq("outlet_id", outletId).eq("category_id", ACCOMMODATION_CATEGORY_ID).eq("status", "active").limit(1),
    db.from("outlet_offers").select("product_id,products!inner(category_id,status)").eq("outlet_id", outletId).eq("status", "active")
      .eq("products.category_id", ACCOMMODATION_CATEGORY_ID).eq("products.status", "active").limit(1),
  ]);
  return Boolean(direct.data?.length || offered.data?.length);
}
