import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ratingFromRows } from "@/lib/reviews/rating-summary";
import { selectPublicDocument } from "@/lib/vendor/outlet-page-persistence";
import { getOutletProductIds } from "@/backend/domains/catalogue";
import { addDays, buildPublicOutletProfile, resolveStaySearch, stayNightStartsAt, getActiveDefaultOutletVariant, getOutletAvailableStock, getOutletNavigationModel, getOutletVariantPrice, selectFullOutletMenu } from "@/lib/customer/outlet-shop";
import { OutletPageRenderer } from "@/components/outlet/outlet-page-renderer";
import { ShareButton } from "@/components/shared/share-button";
import { OutletChatButton } from "@/components/customer/outlet-chat-button";
import { getServerTranslation } from "@/lib/i18n/server";
import { productImageUrl } from "@/lib/storage/product-image";
import { BRAND_NAME } from "@/lib/i18n/invariant-tokens";
import { selectEntityGallery, selectEntityLogo, type EntityMediaRow } from "@/lib/customer/entity-media";
import { serializeJsonLd } from "@/lib/seo/json-ld";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ vendorId: string; outletId: string }>;
  searchParams?: Promise<{ checkin?: string; checkout?: string; rooms?: string; adults?: string }>;
}

async function getPublicOutletPage(outletId: string, vendorId: string) {
  const db = await createClient();
  const [{ data: outlet }, { data: page }, { data: outlets }, { data: media }] = await Promise.all([
    db
      .from("outlets")
      .select("id,name,address,city,state,country,phone,email,operating_hours,wheelchair_accessible,pet_friendly,check_in_time,check_out_time,stay_policies,vendors(id,name,logo_url)")
      .eq("id", outletId)
      .eq("vendor_id", vendorId)
      .eq("status", "active")
      .eq("review_status", "approved")
      .maybeSingle(),
    db.from("public_outlet_pages").select("*").eq("outlet_id", outletId).maybeSingle(),
    db.from("outlets").select("id,name").eq("vendor_id", vendorId).eq("status", "active").eq("review_status", "approved").order("name"),
    db.from("media_assets").select("url,alt_text,media_type,sort_order").eq("outlet_id", outletId).is("product_id", null).order("sort_order"),
  ]);
  const entityRows = ((media || []) as Array<{ url: string; alt_text: string | null; media_type: string | null; sort_order: number | null }>).map((row): EntityMediaRow => ({ url: row.url, altText: row.alt_text, mediaType: row.media_type, sortOrder: row.sort_order }));
  const gallery = selectEntityGallery(entityRows, 3);
  return { outlet, page, outlets: outlets || [], gallery: gallery.length ? gallery : selectEntityGallery(entityRows), logoUrl: selectEntityLogo(entityRows) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { outletId, vendorId } = await params;
  const { outlet, page, gallery } = await getPublicOutletPage(outletId, vendorId);
  const { t } = await getServerTranslation("customer");
  if (!outlet) return { title: t("ui.outletPage.notFound") };
  const document = selectPublicDocument(page || {});
  const vendor = Array.isArray(outlet.vendors) ? outlet.vendors[0] : undefined;

  // Rating prefix for the WhatsApp/social preview card — never fabricated,
  // omitted entirely when there are zero visible reviews.
  const { data: reviewRows } = await createServiceClient().from("reviews").select("rating").eq("outlet_id", outletId).eq("is_visible", true);
  const { rating } = await ratingFromRows(reviewRows ?? []);
  const baseDescription = document.seoDescription || t("ui.outletPage.metaDescription", { name: outlet.name });
  const description = rating !== null ? `★ ${rating.toFixed(1)} · ${baseDescription}` : baseDescription;
  const url = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/customer/vendor/${vendorId}/outlet/${outletId}`;

  return {
    title: document.seoTitle || `${outlet.name}${vendor ? ` — ${vendor.name}` : ""} | ${BRAND_NAME}`,
    description,
    openGraph: {
      title: document.seoTitle || outlet.name,
      description,
      url,
      images: document.hero.imageUrl || gallery[0]?.url ? [{ url: document.hero.imageUrl || gallery[0].url }] : undefined,
    },
  };
}

export default async function VendorOutletPage({ params, searchParams }: Props) {
  const { outletId, vendorId } = await params;
  const search = (await searchParams) ?? {};
  const { outlet, page, outlets, gallery, logoUrl } = await getPublicOutletPage(outletId, vendorId);
  if (!outlet) notFound();
  const { t } = await getServerTranslation("customer");

  const outletNavigation = getOutletNavigationModel(outlets, outlet.id);

  const document = selectPublicDocument(page || {});
  const vendor = Array.isArray(outlet.vendors) ? outlet.vendors[0] : undefined;
  const profile = buildPublicOutletProfile({
    outletName: outlet.name,
    vendorName: vendor?.name,
    address: outlet.address,
    city: outlet.city,
    state: outlet.state,
    country: outlet.country,
    phone: outlet.phone,
    email: outlet.email,
    operatingHours: outlet.operating_hours,
    introTitle: t("ui.outletPage.introTitle"),
    introBody: t("ui.outletPage.introBody", { vendor: vendor?.name || outlet.name, city: outlet.city || t("ui.labels.malaysia") }),
  });
  const publicOutlet = {
    ...outlet,
    vendorId: vendor?.id || vendorId,
    vendorName: vendor?.name ?? null,
    address: profile.address,
    city: profile.city,
    state: profile.state,
    country: profile.country,
    phone: profile.phone,
    email: profile.email,
    operating_hours: profile.operatingHours,
    logoUrl: logoUrl || vendor?.logo_url || null,
  };
  const availableGallery = gallery.length ? gallery : document.gallery;
  const heroImageUrl = gallery[0]?.url || document.hero.imageUrl || document.gallery[0]?.url;
  const visibleGallery = availableGallery.filter((item) => item.url !== heroImageUrl);
  const publicDocument = {
    ...document,
    gallery: visibleGallery,
    hero: {
      ...document.hero,
      imageUrl: heroImageUrl,
      title:
        document.hero.title === "Discover this outlet" || !document.hero.title.trim()
          ? t("ui.outletPage.heroTitle")
          : document.hero.title,
      body:
        document.hero.body === "Discover local food, culture and experiences from this outlet."
          ? profile.introBody
          : document.hero.body,
    },
    blocks: document.blocks.map((block) =>
      block.type === "intro"
        ? { ...block, title: block.title === "Welcome to this outlet" ? profile.introTitle : block.title, body: block.body || profile.introBody }
        : block
    ),
  };

  const db = await createClient();
  const sellable = await getOutletProductIds(db, outletId);
  const sellableIds = [...sellable];
  const sellableSet = new Set(sellableIds);
  const featuredIds = publicDocument.featuredIds.filter((id) => sellableSet.has(id));
  const [{ data: products }, { data: offers }, { data: slots }, { data: reviewMetrics }] = sellableIds.length
    ? await Promise.all([
        db.from("products").select("id,name,description,base_price,requires_booking,cover_url,product_type,outlet_id,categories(name,slug),product_variants(id,name,price_offset,is_default,is_active,inventory(outlet_id,quantity,reserved))").eq("status", "active").eq("review_status", "approved").in("id", sellableIds),
        db.from("outlet_offers").select("product_id,price").eq("outlet_id", outletId).eq("status", "active").in("product_id", sellableIds),
        db.from("booking_slots").select("id,product_id,starts_at,status").in("product_id", sellableIds).eq("outlet_id", outletId).eq("status", "available").gt("starts_at", new Date().toISOString()).order("starts_at"),
        db.from("product_review_metrics").select("product_id,rating,reviews").in("product_id", sellableIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const offerPriceByProduct = new Map((offers || []).map((offer) => [offer.product_id, Number(offer.price)]));
  const firstSlotByProduct = new Map<string, string>();
  for (const slot of slots || []) if (!firstSlotByProduct.has(slot.product_id)) firstSlotByProduct.set(slot.product_id, slot.id);
  const metricByProduct = new Map((reviewMetrics || []).map((metric) => [metric.product_id, { rating: Number(metric.rating), reviews: Number(metric.reviews) }]));
  const STAY_SLUG = "accommodation";
  const stayIds = (products || []).filter((p) => p.categories?.[0]?.slug === STAY_SLUG).map((p) => p.id);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  const stay = resolveStaySearch(search, today);
  const nightDays = Array.from({ length: stay.nights }, (_, k) => addDays(stay.checkIn, k));
  const nightSlots = stayIds.length
    ? (await db.from("booking_slots").select("id,product_id,starts_at,capacity,booked,status,price_override").in("product_id", stayIds).eq("outlet_id", outletId).in("starts_at", nightDays.map(stayNightStartsAt))).data || []
    : [];
  const stayByProduct = new Map(stayIds.map((id) => {
    const nights = nightDays.map((day) => nightSlots.find((s) => s.product_id === id && Date.parse(s.starts_at) === Date.parse(stayNightStartsAt(day))));
    const left = Math.min(...nights.map((s) => (s && s.status === "available" ? Math.max(Number(s.capacity) - Number(s.booked), 0) : 0)));
    return [id, { left, checkInSlotId: nights[0]?.id ?? null, overrides: nights.map((s) => (s?.price_override == null ? null : Number(s.price_override))) }];
  }));
  const menuProducts = selectFullOutletMenu(
    (products || []).map((product) => {
      const variants = product.product_variants || [];
      const outletScopedVariant = product.requires_booking || product.product_type === "digital" ? undefined : outletId;
      const purchaseVariant = getActiveDefaultOutletVariant(variants, outletScopedVariant);
      const availableStock = outletScopedVariant ? getOutletAvailableStock(variants, outletId) : undefined;
      const outletPrice = offerPriceByProduct.get(product.id) ?? Number(product.base_price);
      const metric = metricByProduct.get(product.id) || { rating: 0, reviews: 0 };
      return {
        id: product.id,
        name: product.name,
        description: product.description,
        base_price: getOutletVariantPrice(outletPrice, purchaseVariant?.price_offset),
        category: product.categories?.[0]?.name ?? null,
        ...(stayByProduct.has(product.id) && {
          stay: {
            total: stayByProduct.get(product.id)!.overrides.reduce<number>((sum, o) => sum + (o ?? getOutletVariantPrice(outletPrice, purchaseVariant?.price_offset)), 0),
            left: stayByProduct.get(product.id)!.left,
            checkInSlotId: stayByProduct.get(product.id)!.checkInSlotId,
          },
        }),
        product_type: product.product_type,
        requires_booking: product.requires_booking,
        cover_url: productImageUrl(product.cover_url),
        outlet_id: outletId,
        variant_id: purchaseVariant?.id ?? null,
        variant_label: purchaseVariant?.name ?? null,
        first_available_slot_id: firstSlotByProduct.get(product.id) ?? null,
        available_stock: availableStock,
        rating: metric.rating,
        reviews: metric.reviews,
      };
    }),
    featuredIds
  );

  const stayOutlet = {
    ...publicOutlet,
    ...(stayIds.length && {
      stay: {
        ...stay,
        checkInTime: outlet.check_in_time?.slice(0, 5) ?? null,
        checkOutTime: outlet.check_out_time?.slice(0, 5) ?? null,
        policies: outlet.stay_policies ?? null,
      },
    }),
  };

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: outlet.name,
    description: publicDocument.seoDescription || profile.introBody,
    telephone: profile.phone,
    email: profile.email,
    address: { "@type": "PostalAddress", streetAddress: profile.address, addressLocality: profile.city, addressRegion: profile.state, addressCountry: profile.country === "Malaysia" ? "MY" : profile.country },
    url: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/customer/vendor/${vendorId}/outlet/${outlet.id}`,
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{vendor ? <a href={`/customer/vendor/${vendorId}`} className="hover:text-primary hover:underline">{vendor.name}</a> : t("ui.labels.mywisataOutlet")}</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{outlet.name}</p>
          {vendor && (
            <p className="mt-0.5 text-xs text-muted-foreground/60">
              {t("ui.outletPage.verified")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ShareButton shareType="outlet" contentId={outlet.id} title={outlet.name} />
          <OutletChatButton outletId={outlet.id} />
        </div>
        </div>
      </div>
      {outletNavigation.hasMultipleOutlets && <div className="mx-auto max-w-7xl px-6 pt-5">
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/10 bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{t("ui.outlet.exploreOutlet")}</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{t("strictMigration.outletNavigation.position", { current: outletNavigation.currentPosition, total: outletNavigation.total, outlet: outlet.name })}</p>
          </div>
          <a href={`/customer/vendor/${vendorId}#locations`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">{t("strictMigration.outletNavigation.viewAll", { count: t("ui.vendor.activeOutletCount", { count: outletNavigation.total }) })} <ArrowRight size={15} /></a>
        </div>
      </div>}
      <OutletPageRenderer document={publicDocument} outlet={stayOutlet} products={menuProducts} mode="public" />
    </main>
  );
}
