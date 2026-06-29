import { SEED_DECISION_TABLES } from '@zenith/shared';
import type { RuleDecisionTable } from '@zenith/shared';
import { mockDateTime } from '@/mocks/utils/date';

export const mockDecisionTables: RuleDecisionTable[] = SEED_DECISION_TABLES.map((t) => ({
  ...t,
  description: t.description ?? null,
  categoryId: null,
  status: 'draft',
  version: 1,
  publishedAt: null,
  createdAt: mockDateTime(),
  updatedAt: mockDateTime(),
}));

let seq = mockDecisionTables.length + 1;
export const getNextTableId = () => seq++;

export const mockDecisionVersions: Record<number, Array<{ version: number; name: string; hitPolicy: string; inputs: unknown; outputs: unknown; rules: unknown; publishedAt: string }>> = {};
