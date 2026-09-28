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

export const campaignAdminPatchSchema = z.union([
  z.object({ action: z.literal("save_draft"), campaign: campaignDraftUpdateSchema }).strict(),
  campaignTransitionSchema,
]);
