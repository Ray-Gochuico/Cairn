import { z } from 'zod';
import { LeverPayloadSchema } from '@/lib/scenarios';

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const ScenarioSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1, 'name is required'),
  isBaseline: z.boolean(),
  color: z.string().regex(HEX_COLOR, 'color must be a hex like #4f86f7'),
  lineStyle: z.enum(['solid', 'dashed']),
  visible: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  leverPayload: LeverPayloadSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;
