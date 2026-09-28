import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Store } from "lucide-react";
import { getServerTranslation } from "@/lib/i18n/server";
import { BRAND_NAME } from "@/lib/i18n/invariant-tokens";
import { getPublicPromotionCampaigns } from "@/lib/promotion-campaigns/public";
import { campaignSlugSchema } from "@/lib/promotion-campaigns/validation";
import { formatMYR } from "@/lib/i18n/format";
import { CustomerPageShell } from "@/components/customer/customer-page-shell";

type Props = { params: Promise<{ slug: string; vendorId: string }> };

async function findStall(slug: string, vendorId: string) {
  const parsedSlug = campaignSlugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;
  const result = await getPublicPromotionCampaigns(parsedSlug.data);
  const campaign = result.campaigns[0];
  if (!campaign) return null;
  const vendor = campaign.vendors.find((entry) => entry.vendorId === vendorId);
  if (!vendor) return null;
  return { campaign, vendor };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, vendorId } = await params;
  const found = await findStall(slug, vendorId);
  if (!found) return { title: `${BRAND_NAME}` };
  const title = `${found.vendor.vendorName} · ${found.campaign.title} — ${BRAND_NAME}`;
  return { title, description: found.vendor.stallDescription.slice(0, 160) };
}

export default async function EventVendorStallPage({ params }: Props) {
  const { slug, vendorId } = await params;
  const { t } = await getServerTranslation("customer");
  const found = await findStall(slug, vendorId);
  if (!found) notFound();
  const { campaign, vendor } = found;

  return (
    <CustomerPageShell wide>
      <Link href={`/customer/events/${encodeURIComponent(slug)}`} className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" /> {t("ui.promotionCampaigns.backToEvent", { title: campaign.title })}
      </Link>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={vendor.stallPosterUrl} alt="" className="h-56 w-full rounded-2xl border border-border object-cover sm:h-72 lg:h-80" />

      <div className="mt-5 flex items-center gap-3">
        <Store className="text-primary" size={22} aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">{vendor.vendorName}</h1>
          <p className="text-sm text-muted-foreground">{t("ui.promotionCampaigns.stallNumber", { number: vendor.stallNumber })}</p>
        </div>
      </div>

      <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{vendor.stallDescription}</p>

      {vendor.products.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-bold text-foreground">{t("ui.promotionCampaigns.stallProducts")}</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {vendor.products.map((product) => (
              <li key={product.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                {product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={product.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="h-14 w-14 shrink-0 rounded-lg bg-secondary" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{product.name}</p>
                  <p className="text-sm text-primary">{formatMYR(product.price)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </CustomerPageShell>
  );
}
