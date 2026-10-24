import { z } from "zod";

export const staffEmployeeSchema = z.object({
  id: z.string().uuid(), name: z.string(), email: z.string(), status: z.string(), roles: z.array(z.string()),
});
export const staffEmployeeAccessSchema = z.object({
  id: z.string().uuid(), name: z.string(), email: z.string(), status: z.string(), coarseRoles: z.array(z.string()),
  assignments: z.array(z.object({
    id: z.string().uuid(), roleId: z.string().uuid(), roleName: z.string(),
    isSystem: z.boolean(), isActive: z.boolean(), createdAt: z.string().nullable(),
  })),
  sources: z.array(z.object({
    permissionKey: z.string(), sourceType: z.enum(["super_admin", "assignment", "legacy_role"]),
    sourceId: z.string().uuid().nullable(), sourceName: z.string(),
  })),
});
export const staffEmployeePageSchema = z.object({
  items: z.array(staffEmployeeSchema), total: z.number().int().nonnegative(), page: z.number().int().positive(),
  pageSize: z.number().int().positive(), totalPages: z.number().int().nonnegative(),
});
export type StaffEmployeeAccess = z.infer<typeof staffEmployeeAccessSchema>;
export type StaffEmployeePage = z.infer<typeof staffEmployeePageSchema>;
