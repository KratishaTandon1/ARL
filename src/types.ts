import { z } from 'zod';

export const createTraySchema = z.object({
  code: z.string().min(1),
  zone: z.string().min(1),
  capacity_units: z.number().int().positive()
});

export const seedBatchSchema = z.object({
  tray_id: z.string().uuid(),
  crop: z.string().min(1),
  expected_harvest_on: z.string().datetime().optional()
});

export const advanceStageSchema = z.object({
  // Only forward stages are valid for input to PATCH, but we will validate transition logic in handler
  stage: z.enum(['GERMINATION', 'GROWING', 'HARVEST_READY', 'HARVESTED'])
});

export const recordHarvestSchema = z.object({
  weight_grams: z.number().int().positive(),
  grade: z.enum(['A', 'B', 'C'])
});

export const batchFilterSchema = z.object({
  stage: z.enum(['SEEDED', 'GERMINATION', 'GROWING', 'HARVEST_READY', 'HARVESTED']).optional(),
  crop: z.string().optional(),
  zone: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20)
});

export const yieldReportSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  group_by: z.enum(['crop', 'zone'])
});
