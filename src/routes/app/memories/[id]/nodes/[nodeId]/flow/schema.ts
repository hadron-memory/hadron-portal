import { z } from 'zod';

export const createFlowEdgeSchema = z
  .object({
    _kind: z.literal('createFlowEdge').default('createFlowEdge'),
    sourceId: z.string().trim().min(1, 'Missing source node').prefault(''),
    targetId: z.string().trim().min(1, 'Missing target node').prefault(''),
  })
  .superRefine((data, ctx) => {
    if (data.sourceId === data.targetId) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'A node cannot route to itself',
      });
    }
  });

export type CreateFlowEdgeSchema = typeof createFlowEdgeSchema;
