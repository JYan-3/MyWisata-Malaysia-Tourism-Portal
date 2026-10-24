/**
 * Server-only cached wrappers for public catalogue data.
 *
 * Import these in Server Components and API routes instead of calling
 * getActivities() / getOutlets() directly, so that multiple requests
 * within the same revalidation window share a single DB round-trip.
 *
 * Uses the service-role client (no cookies) so that unstable_cache can
 * execute without hitting Next.js's "dynamic data source inside cache"
 * restriction. Catalogue data is public — RLS does not filter it by user.
 *
 * IMPORTANT: Only import from server-side code (Server Components, API
 * routes, Server Actions). Never import from client components.
 */
import { unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import {
  applyDiscoveryReviewMetrics,
  computeDiscoveryActivities,
  getActivities,
  getDiscoveryOutletIds,
  getDiscoveryOutletsByIds,
  getDiscoveryProductActivities,
  getDiscoveryReviewMetricEntries,
  getOutlets,
} from '@/backend/domains/catalogue';
import type { Activity, ComputedActivity, Outlet } from '@/backend/core/types';
import type { DiscoveryActivityData } from '@/backend/domains/catalogue';

/**
 * Cached getActivities — revalidates every 60 seconds.
 * Returns raw Activity[] — suitable for catalogue maps (e.g. checkout prepare).
 */
export const getCachedActivities: () => Promise<Activity[]> = unstable_cache(
  async () => {
    const db = createServiceClient();
    return getActivities(db);
  },
  ['catalogue-activities'],
  { revalidate: 60, tags: ['activities'] },
);

const getCachedDiscoveryProductActivities = unstable_cache(
  async () => {
    const db = createServiceClient();
    return getDiscoveryProductActivities(db);
  },
  ['catalogue-discovery-products'],
  { revalidate: 60, tags: ['activities'] },
);

const getCachedDiscoveryRelatedData = unstable_cache(
  async (productIds: string[], outletIds: string[]) => {
    const db = createServiceClient();
    // Keep catalogue refreshes within the bounded query concurrency used by
    // the discovery loaders: each helper batches internally, so run them in turn.
    const metrics = await getDiscoveryReviewMetricEntries(productIds, db);
    const outlets = await getDiscoveryOutletsByIds(outletIds, db);
    return { metrics, outlets };
  },
  ['catalogue-discovery-related-data'],
  { revalidate: 60, tags: ['activities', 'outlets'] },
);

/**
 * Assemble the public discovery shape outside the cache. Keeping the products,
 * review metrics, and shared outlet records in separate entries avoids storing
 * the same outlet metadata once for every product card.
 */
export async function getCachedDiscoveryActivityData(): Promise<DiscoveryActivityData> {
  const activities = await getCachedDiscoveryProductActivities();
  if (activities.length === 0) return { activities: [], outlets: [] };

  const productIds = [...new Set(activities.map((activity) => activity.id))].sort();
  const outletIds = getDiscoveryOutletIds(activities);
  const { metrics, outlets } = await getCachedDiscoveryRelatedData(productIds, outletIds);

  return { activities: applyDiscoveryReviewMetrics(activities, metrics), outlets };
}

export async function getCachedComputedActivities(): Promise<ComputedActivity[]> {
  return computeDiscoveryActivities(await getCachedDiscoveryActivityData());
}

/**
 * Cached getOutlets — revalidates every 60 seconds.
 */
export const getCachedOutlets: () => Promise<Outlet[]> = unstable_cache(
  async () => {
    const db = createServiceClient();
    return getOutlets(db);
  },
  ['catalogue-outlets'],
  { revalidate: 60, tags: ['outlets'] },
);
