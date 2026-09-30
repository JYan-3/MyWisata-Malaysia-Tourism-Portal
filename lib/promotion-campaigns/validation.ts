import { z } from "zod";
import { PROMOTION_CAMPAIGN_STATUSES } from "./types";

export const campaignSlugSchema = z.string().trim().min(3).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const campaignFieldsSchema = z.object({
  title: z.string().trim().min(3).max(120),
  slug: campaignSlugSchema,
  summary: z.string().trim().min(10).max(240),
  description: z.string().trim().min(10).max(5000),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  posterUrl: z.string().url().max(2000).nullable(),
  operatingHours: z.string().trim().min(3).max(200),
}).strict();

function validateCampaignDates(
  value: { startsAt: string; endsAt: string },
  context: z.RefinementCtx,
) {
  if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "End must be after start" });
  }
}

export const campaignCreateSchema = campaignFieldsSchema.superRefine(validateCampaignDates);

export const campaignTransitionSchema = z.object({
  action: z.enum(["submit", "approve", "reject", "pause", "resume", "archive"]),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  note: z.string().trim().min(10).max(500).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "reject" && !value.note) {
    context.addIssue({ code: "custom", path: ["note"], message: "A rejection reason is required" });
  }
});

export const campaignDraftUpdateSchema = campaignFieldsSchema.extend({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict().superRefine(validateCampaignDates);

export const campaignStatusSchema = z.enum(PROMOTION_CAMPAIGN_STATUSES);

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** One event location. Dates and hours are Malaysia wall-clock values. */
export const campaignLocationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(3).max(300).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  opensAt: clockTimeSchema,
  closesAt: clockTimeSchema,
}).strict().superRefine((value, context) => {
  if ((value.lat === null) !== (value.lng === null)) {
    context.addIssue({ code: "custom", path: ["lat"], message: "Set both coordinates or neither" });
  }
  // Same-width ISO dates and HH:MM times compare correctly as strings.
  if (value.endsOn < value.startsOn) {
    context.addIssue({ code: "custom", path: ["endsOn"], message: "End date must not be before start date" });
  }
  if (value.closesAt <= value.opensAt) {
    context.addIssue({ code: "custom", path: ["closesAt"], message: "Closing time must be after opening time" });
  }
});

export type CampaignLocationInput = z.infer<typeof campaignLocationSchema>;

export const campaignAdminPatchSchema = z.union([
  z.object({ action: z.literal("save_draft"), campaign: campaignDraftUpdateSchema }).strict(),
  campaignTransitionSchema,
]);
