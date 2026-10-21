import { getCachedComputedActivities } from "@/lib/cache/catalogue-cache";
import type { ComputedActivity } from "@/backend/core/types";
import { canonicalCategorySlug } from "@/lib/customer/discovery-categories";
import { ExperiencePhotoWallClient } from "./experience-client";

export default async function ExperiencePhotoWallPage() {
  let initialActivities: ComputedActivity[] = [];
  let dataUnavailable = false;

  try {
    const activities = await getCachedComputedActivities();
    initialActivities = activities.filter((activity) => canonicalCategorySlug(activity.categorySlug) === "activity");
  } catch (error) {
    console.error("Failed to load dev experience catalogue", error);
    dataUnavailable = true;
  }

  return <ExperiencePhotoWallClient initialActivities={initialActivities} dataUnavailable={dataUnavailable} />;
}
