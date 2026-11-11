import { z } from 'zod';

export const grantCreateSchema = z
  .object({
    viewerId: z.string().min(1),
    ownerId: z.string().min(1),
  })
  .refine((v) => v.viewerId !== v.ownerId, { message: 'self', path: ['ownerId'] });
export type GrantCreateInput = z.infer<typeof grantCreateSchema>;

export const grantDeleteSchema = z.object({ grantId: z.string().min(1) });
export type GrantDeleteInput = z.infer<typeof grantDeleteSchema>;
