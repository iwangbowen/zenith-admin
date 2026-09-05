import { SEED_DECISION_TABLES } from '@zenith/shared/seed';
import type { RuleDecisionTable, RuleDecisionTableVersion, RuleExecution, RuleTestCase } from '@zenith/shared/rules';
import { mockDateTime } from '@/mocks/utils/date';

export const mockDecisionTables: RuleDecisionTable[] = SEED_DECISION_TABLES.map((t) => ({
  ...t,
  description: t.description ?? null,
  categoryId: null,
  status: 'draft',
  settings: {},
  version: 1,
  publishedAt: null,
  gray: null,
  dirty: false,
  reviewStatus: null,
  reviewRequestedBy: null,
  reviewRequestedAt: null,
  reviewComment: null,
  createdAt: mockDateTime(),
  updatedAt: mockDateTime(),
}));

let seq = mockDecisionTables.length + 1;
export const getNextTableId = () => seq++;

/** 已发布版本快照（新版本在前） */
export const mockDecisionVersions: Record<number, RuleDecisionTableVersion[]> = {};
let versionSeq = 1;
export const getNextVersionId = () => versionSeq++;
export const mockTestCases: Record<number, RuleTestCase[]> = {};
let caseSeq = 1;
export const getNextCaseId = () => caseSeq++;
export const mockExecutions: RuleExecution[] = [];
let execSeq = 1;
export const getNextExecId = () => execSeq++;
