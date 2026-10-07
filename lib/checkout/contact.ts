import { parseInternationalPhone } from '@/lib/phone/international';
import { z } from 'zod';
export const checkoutContactSchema = z.object({
  email: z.string().trim().email().max(254), name: z.string().trim().min(1).max(100).nullable().optional(),
  phone: z.string().trim().min(5).max(30).refine(value => parseInternationalPhone(value).ok, 'Enter a valid international phone number').transform(value => { const parsed = parseInternationalPhone(value); return parsed.ok ? parsed.e164 : value; }).nullable().optional(),
}).strict();
