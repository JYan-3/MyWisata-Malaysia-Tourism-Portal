import { z } from 'zod';

export const EVENT_CASE_KINDS = ['all', 'payment_unfulfillable', 'refund_attention', 'pickup_overdue'] as const;
export const EVENT_CASE_HANDLING = ['open', 'needs_review', 'awaiting_provider', 'refund_failed', 'resolved', 'all'] as const;
export const EVENT_CASE_OWNERS = ['all', 'unassigned', 'mine', 'others'] as const;
export const EVENT_CASE_DEADLINES = ['all', 'overdue', 'upcoming', 'undated'] as const;

export const eventOperationsQuerySchema = z.object({
  caseSearch: z.string().trim().max(100).default(''),
  caseKind: z.enum(EVENT_CASE_KINDS).default('all'),
  caseHandling: z.enum(EVENT_CASE_HANDLING).default('open'),
  caseOwner: z.enum(EVENT_CASE_OWNERS).default('all'),
  caseDeadline: z.enum(EVENT_CASE_DEADLINES).default('all'),
  casePage: z.coerce.number().int().min(1).max(1000000).default(1),
}).strict();
export type EventOperationsFilters = z.infer<typeof eventOperationsQuerySchema>;
export const DEFAULT_EVENT_OPERATIONS_FILTERS: EventOperationsFilters = eventOperationsQuerySchema.parse({});
