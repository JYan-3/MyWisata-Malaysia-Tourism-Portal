"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List, MapPin, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { filterComputedActivities, STATES_MY, type SearchFilters } from "@/backend/domains/catalogue";
import type { ComputedActivity } from "@/backend/core/types";
import { ActivityCard } from "@/components/customer/activity-card";
import { CategoryIcon } from "@/components/customer/category-icon";
import { DiscoverySearchField } from "@/components/customer/discovery-filters";
import { CustomerPageHeader, CustomerPageShell } from "@/components/customer/customer-page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { ReferencePrice } from "@/components/shared/reference-price";
import { CustomerCapabilityGateProvider } from "@/components/customer/customer-capability-gate-dialog";
import { WishlistProvider } from "@/components/providers/wishlist";
import { CATEGORY_DETAILS } from "@/lib/customer/category-details";
import { buildActivityPath } from "@/lib/customer/navigation-context";
import { parseDiscoveryQuery, serializeDiscoveryQuery, type DiscoveryQuery } from "@/lib/customer/discovery-query";

type ExperienceView = "wall" | "compare";
type ExperienceSort = Extract<NonNullable<SearchFilters["sort"]>, "recommended" | "price_asc" | "rating_desc">;

const DEFAULT_VISIBLE_COUNT = 8;
const CUSTOMER_EXPLORE_RETURN_TO = "/customer/explore?tab=experiences";
const EXPERIENCE_TYPES = CATEGORY_DETAILS.activity.types;

function normalizeExperienceFilters(params: URLSearchParams): DiscoveryQuery {
  const parsed = parseDiscoveryQuery(params);
  const knownTypes = new Set(EXPERIENCE_TYPES.map((type) => type.slug));
  return {
    ...parsed,
    categories: ["activity"],
    types: parsed.types.filter((type) => {
      const [category, slug] = type.split(":", 2);
      return category === "activity" && knownTypes.has(slug);
    }),
  };
}

function readSort(params: URLSearchParams): ExperienceSort {
  const value = params.get("sort");
  return value === "price_asc" || value === "rating_desc" ? value : "recommended";
}

function buildExploreUrl(filters: DiscoveryQuery, sort: ExperienceSort, view: ExperienceView): string {
  const params = serializeDiscoveryQuery({ ...filters, categories: ["activity"] });
  if (sort !== "recommended") params.set("sort", sort);
  if (view === "compare") params.set("view", view);
  const query = params.toString();
  return query ? `/dev/explore/experience?${query}` : "/dev/explore/experience";
}

function hasActiveFilters(filters: DiscoveryQuery): boolean {
  return Boolean(
    filters.q.trim()
    || filters.state
    || filters.types.length
    || filters.priceMax !== null
    || filters.openNow
    || filters.freeOnly
    || filters.bookableOnly
    || filters.hiddenGemOnly
    || filters.familyFriendlyOnly
    || filters.coupleFriendlyOnly,
  );
}

function activityLocation(activity: ComputedActivity): string {
  const city = activity.outlet.city?.trim();
  const state = activity.place?.state ?? activity.outlet.state;
  return [city, state].filter(Boolean).join(", ");
}

export function ExperiencePhotoWallClient({
  initialActivities,
  dataUnavailable,
}: {
  initialActivities: ComputedActivity[];
  dataUnavailable: boolean;
}) {
  const { t } = useTranslation("customer");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState(() => normalizeExperienceFilters(new URLSearchParams(searchParams.toString())));
  const [sort, setSort] = useState<ExperienceSort>(() => readSort(new URLSearchParams(searchParams.toString())));
  const [view, setView] = useState<ExperienceView>(() => searchParams.get("view") === "compare" ? "compare" : "wall");
  const [visibleLimit, setVisibleLimit] = useState(DEFAULT_VISIBLE_COUNT);

  const results = useMemo(() => filterComputedActivities({
    ...filters,
    categories: ["activity"],
    sort,
  }, initialActivities), [filters, initialActivities, sort]);
  const visibleResults = results.slice(0, visibleLimit);
  const isFiltered = hasActiveFilters(filters);

  const updateUrl = (nextFilters: DiscoveryQuery, nextSort = sort, nextView = view) => {
    router.replace(buildExploreUrl(nextFilters, nextSort, nextView), { scroll: false });
  };

  const updateFilters = (patch: Partial<DiscoveryQuery>) => {
    const next = { ...filters, ...patch, categories: ["activity"] };
    setFilters(next);
    setVisibleLimit(DEFAULT_VISIBLE_COUNT);
    updateUrl(next);
  };

  const selectType = (slug: string | null) => {
    updateFilters({ types: slug ? [`activity:${slug}`] : [] });
  };

  const changeSort = (nextSort: ExperienceSort) => {
    setSort(nextSort);
    setVisibleLimit(DEFAULT_VISIBLE_COUNT);
    updateUrl(filters, nextSort);
  };

  const changeView = (nextView: ExperienceView) => {
    setView(nextView);
    updateUrl(filters, sort, nextView);
  };

  const clearFilters = () => {
    const next = normalizeExperienceFilters(new URLSearchParams());
    setFilters(next);
    setSort("recommended");
    setVisibleLimit(DEFAULT_VISIBLE_COUNT);
    updateUrl(next, "recommended");
  };

  const activeType = filters.types.length === 1 ? filters.types[0].split(":")[1] : null;

  const pageContent = (
    <main className="min-h-screen bg-background">
      <CustomerPageShell wide>
        <CustomerPageHeader
          eyebrow={t("ui.explore.eyebrow")}
          title={t("ui.explore.experiencePageTitle")}
          description={t("ui.explore.experiencePageDescription")}
          className="mb-6"
        />

        <section aria-label={t("ui.discovery.advancedFilters")} className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_minmax(160px,220px)_minmax(150px,190px)]">
            <DiscoverySearchField
              value={filters.q}
              onChange={(q) => updateFilters({ q })}
              placeholder={t("ui.map.searchExperience")}
            />
            <label className="text-xs font-semibold text-muted-foreground">
              <span>{t("ui.discovery.state")}</span>
              <select
                aria-label={t("ui.discovery.state")}
                value={filters.state ?? ""}
                onChange={(event) => updateFilters({ state: event.target.value || null })}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-normal text-foreground"
              >
                <option value="">{t("ui.map.allStatesTerritories")}</option>
                {STATES_MY.filter((state) => state !== "All Malaysia").map((state) => <option key={state} value={state}>{state}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-muted-foreground">
              <span>{t("ui.explore.maximumPrice")}</span>
              <Input
                aria-label={t("ui.explore.maximumPrice")}
                type="number"
                min="0"
                max="10000"
                step="0.01"
                value={filters.priceMax ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  const amount = value === "" ? null : Number(value);
                  if (amount === null || (Number.isFinite(amount) && amount >= 0 && amount <= 10_000)) {
                    updateFilters({ priceMax: amount });
                  }
                }}
                className="mt-1.5 min-h-11 bg-background"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("ui.discovery.experienceTypes")}>
              <button
                type="button"
                aria-pressed={activeType === null}
                onClick={() => selectType(null)}
                className={`min-h-9 rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 ${activeType === null ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted/60"}`}
              >
                {t("ui.explore.allExperiences")}
              </button>
              {EXPERIENCE_TYPES.map(({ slug }) => (
                <button
                  key={slug}
                  type="button"
                  aria-pressed={activeType === slug}
                  onClick={() => selectType(activeType === slug ? null : slug)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 ${activeType === slug ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted/60"}`}
                >
                  <CategoryIcon category="activity" size={13} />
                  {t(`ui.map.types.${slug}`)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={filters.bookableOnly ? "default" : "outline"}
                aria-pressed={filters.bookableOnly}
                onClick={() => updateFilters({ bookableOnly: !filters.bookableOnly })}
                className="rounded-full"
              >
                {t("ui.discovery.bookableOnly")}
              </Button>
              {isFiltered && (
                <Button type="button" variant="ghost" onClick={clearFilters}>
                  {t("ui.actions.clearFilters")}
                </Button>
              )}
            </div>
          </div>
        </section>

        <section className="mt-7" aria-labelledby="experience-results-heading">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="experience-results-heading" className="text-xl font-bold text-foreground">
                {t("ui.explore.allExperiences")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("ui.explore.results", { count: results.length })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <span>{t("ui.explore.sortBy")}</span>
                <select
                  aria-label={t("ui.explore.sortBy")}
                  value={sort}
                  onChange={(event) => changeSort(event.target.value as ExperienceSort)}
                  className="min-h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
                >
                  <option value="recommended">{t("ui.explore.sortRecommended")}</option>
                  <option value="price_asc">{t("ui.explore.sortPriceAsc")}</option>
                  <option value="rating_desc">{t("ui.explore.sortRatingDesc")}</option>
                </select>
              </label>
              <div className="inline-flex rounded-xl border border-border bg-card p-1" role="group" aria-label={t("ui.explore.viewOptions")}>
                <Button
                  type="button"
                  variant={view === "wall" ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={view === "wall"}
                  onClick={() => changeView("wall")}
                  className="rounded-lg"
                >
                  <LayoutGrid size={15} aria-hidden="true" />
                  {t("ui.explore.photoWall")}
                </Button>
                <Button
                  type="button"
                  variant={view === "compare" ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={view === "compare"}
                  onClick={() => changeView("compare")}
                  className="rounded-lg"
                >
                  <List size={15} aria-hidden="true" />
                  {t("ui.explore.filterCompare")}
                </Button>
              </div>
            </div>
          </div>

          {dataUnavailable ? (
            <EmptyState
              title={t("ui.states.couldNotLoad")}
              description={t("ui.states.loadingError")}
              action={<Button variant="outline" onClick={() => router.refresh()}>{t("ui.actions.retry")}</Button>}
            />
          ) : results.length === 0 ? (
            <EmptyState
              title={t("ui.explore.noExperiences")}
              description={t("ui.explore.noExperiencesDescription")}
              action={isFiltered ? <Button variant="outline" onClick={clearFilters}>{t("ui.actions.clearFilters")}</Button> : undefined}
            />
          ) : view === "wall" ? (
            <div className="columns-1 gap-5 sm:columns-2 lg:columns-3 xl:columns-4" aria-label={t("ui.explore.photoWall")}>
              {visibleResults.map((activity) => (
                <div key={activity.id} className="mb-5 break-inside-avoid">
                  <ActivityCard activity={activity} returnTo={CUSTOMER_EXPLORE_RETURN_TO} />
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {visibleResults.map((activity) => {
                const activityHref = buildActivityPath(activity.id, CUSTOMER_EXPLORE_RETURN_TO);
                const location = activityLocation(activity);
                return (
                  <article key={activity.id} data-testid="experience-compare-row" className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:px-5">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                        <CategoryIcon category="activity" size={18} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold text-foreground">
                          <Link href={activityHref} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                            {activity.name}
                          </Link>
                        </h3>
                        <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <MapPin size={12} aria-hidden="true" />
                          {location || activity.outlet.name}
                          {activity.outlet.vendorName && <><span aria-hidden="true">·</span><span>{activity.outlet.vendorName}</span></>}
                        </p>
                        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <Star size={12} className="fill-accent text-accent" aria-hidden="true" />
                          <span className="font-semibold text-foreground">{activity.rating.toFixed(1)}</span>
                          <span>({activity.reviews})</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      <div className="text-right">
                        <ReferencePrice amountMYR={activity.price} className="font-bold text-primary" />
                        <span aria-hidden="true" className="mx-1 text-xs text-muted-foreground">/</span>
                        <span className="text-xs text-muted-foreground">{t("ui.labels.person")}</span>
                      </div>
                      <Button asChild size="sm">
                        <Link href={activityHref}>{t("ui.actions.viewDetails")}</Link>
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {!dataUnavailable && visibleLimit < results.length && (
            <div className="mt-6 flex justify-center">
              <Button type="button" variant="outline" onClick={() => setVisibleLimit(results.length)}>
                {t("ui.explore.showMore", { count: results.length - visibleLimit })}
              </Button>
            </div>
          )}
        </section>
      </CustomerPageShell>
    </main>
  );

  return (
    <WishlistProvider>
      <CustomerCapabilityGateProvider>{pageContent}</CustomerCapabilityGateProvider>
    </WishlistProvider>
  );
}
