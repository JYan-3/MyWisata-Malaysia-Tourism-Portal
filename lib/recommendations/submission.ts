import { z } from 'zod';

const postgresUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid category ID');

const contactSchema = z.object({
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(254).optional(),
  website: z.string().trim().url().max(500).optional(),
}).superRefine((value, context) => {
  if (!value.phone && !value.email && !value.website) context.addIssue({ code: 'custom', message: 'At least one contact method is required', path: ['phone'] });
});

export const recommendationSubmissionSchema = z.object({
  vendorName: z.string().trim().min(3).max(255),
  description: z.string().trim().min(20).max(2000),
  whyRecommend: z.string().trim().min(20).max(500),
  categoryId: postgresUuidSchema,
  location: z.object({
    placeId: z.string().trim().max(255).nullable().optional(),
    name: z.string().trim().min(2).max(255),
    formattedAddress: z.string().trim().min(5).max(500),
    latitude: z.number().finite().gte(-90).lte(90),
    longitude: z.number().finite().gte(-180).lte(180),
  }),
  contact: contactSchema,
  stagedImageIds: z.array(z.string().uuid()).min(1).max(5).refine((ids) => new Set(ids).size === ids.length, 'Images must be unique'),
  imageAttested: z.literal(true),
}).strict();

export const recommendationResubmissionSchema = recommendationSubmissionSchema.omit({ stagedImageIds: true }).extend({
  expectedVersion: z.string().min(1).max(64),
  retainedImageIds: z.array(z.string().uuid()).max(5),
  stagedImageIds: z.array(z.string().uuid()).max(5),
}).superRefine((value, context) => {
  const ids = [...value.retainedImageIds, ...value.stagedImageIds];
  if (ids.length < 1 || ids.length > 5 || new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['stagedImageIds'], message: 'Keep one to five unique photos' });
  }
});

export type EditableRecommendation = {
  version: string;
  categoryId: string | null;
  location: { placeId: string | null; name: string; formattedAddress: string; latitude: number; longitude: number };
  contact: { phone: string | null; email: string | null; website: string | null };
  images: Array<{ id: string; url: string }>;
};

export function mergeRecommendationImages(current: File[], selected: File[]): File[] {
  return [...current, ...selected].slice(-5);
}

export function allowRecommendationImageSelection(
  currentCount: number,
  selectedCount: number,
  confirmReplacement: () => boolean | Promise<boolean>,
): Promise<boolean> {
  if (currentCount < 5 && currentCount + selectedCount <= 5) return Promise.resolve(true);
  return Promise.resolve(confirmReplacement());
}

export function appendSelectedRecommendationImages(
  selectedFiles: ArrayLike<File> | null,
  updateImages: (update: (current: File[]) => File[]) => void,
): void {
  const selected = Array.from(selectedFiles ?? []);
  updateImages((current) => mergeRecommendationImages(current, selected));
}

export function validateRecommendationImage(file: File): string | null {
  if (file.size > 5 * 1024 * 1024) return 'Image must be 5 MB or smaller';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Use a JPEG, PNG, or WebP image';
  return null;
}

/** Splits a selection into photos the upload route will accept and the names of those it would reject. */
export function partitionRecommendationImages(files: File[]): { accepted: File[]; rejected: string[] } {
  const accepted: File[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    if (validateRecommendationImage(file)) rejected.push(file.name);
    else accepted.push(file);
  }
  return { accepted, rejected };
}
