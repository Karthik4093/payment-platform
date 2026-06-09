import { z } from 'zod';

export const createPaymentSchema = z.object({
  merchantId: z.string().min(1),
  amount: z.number().int().positive().max(10_000_000),
  currency: z.string().length(3).default('USD'),
  metadata: z.record(z.unknown()).optional(),
});

export const getPaymentSchema = z.object({
  id: z.string().uuid(),
});

export type CreatePaymentBody = z.infer<typeof createPaymentSchema>;
export type GetPaymentParams = z.infer<typeof getPaymentSchema>;
