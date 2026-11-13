import { describe, expect, it, vi } from 'vitest';
import type { ReportChatbiMessage, ReportFillRecord } from '@zenith/shared/report';
import { ApiError } from '@/lib/query';
import {
  buildSafeChatbiWidget,
  canRunFillRecordAction,
  chatbiRequestErrorMessage,
  getChatbiSavedResourceAction,
  isRevisionConflict,
  shouldShowFillReviewTab,
  submitFillEntryValues,
  validateFillTemplateInput,
} from './report-p2-utils';

function chatMessage(overrides: Partial<ReportChatbiMessage> = {}): ReportChatbiMessage {
  return {
    id: 1,
    tenantId: null,
    sessionId: 1,
    role: 'assistant',
    content: '结果',
    resultSample: [{ month: '一月', amount: 10 }],
    resultRowCount: 1,
    resultByteSize: 20,
    promptTokens: 10,
    completionTokens: 10,
    costUnits: 1,
    createdAt: '2026-03-23 10:00:00',
    ...overrides,
  };
}

function fillRecord(overrides: Partial<ReportFillRecord> = {}): ReportFillRecord {
  return {
    id: 8,
    tenantId: null,
    templateId: 2,
    submitterId: 3,
    status: 'draft',
    data: {},
    templateRevision: 1,
    templateSchemaSnapshot: { fields: [], settings: {} },
    templateNeedReview: false,
    syncStatus: 'pending',
    revision: 4,
    createdAt: '2026-03-23 10:00:00',
    updatedAt: '2026-03-23 10:00:00',
    ...overrides,
  };
}

describe('ChatBI P2 states', () => {
  it('shows the ownership-safe message for an inaccessible session', () => {
    expect(chatbiRequestErrorMessage(new ApiError(404, 'not found'))).toContain('无权访问');
  });

  it('handles cancelled, failed, and malformed ask output without trusting model chart fields', () => {
    expect(chatbiRequestErrorMessage(new Error('aborted'), true)).toContain('已取消');
    expect(chatbiRequestErrorMessage(new ApiError(422, 'SQL 只允许读取'))).toContain('SQL 只允许读取');
    expect(chatbiRequestErrorMessage({ malformed: true })).toContain('请求失败');

    const widget = buildSafeChatbiWidget(chatMessage({
      chartSuggestion: {
        type: 'html' as never,
        title: 'unsafe',
        categoryField: '<script>',
        valueFields: ['missing'],
      },
    }));
    expect(widget.type).toBe('table');
    expect(widget.options.categoryField).toBe('month');
    expect(widget.options.valueFields).toEqual(['amount']);
  });

  it('exposes save versus open-saved action state explicitly', () => {
    expect(getChatbiSavedResourceAction(chatMessage())).toBeNull();
    expect(getChatbiSavedResourceAction(chatMessage({
      savedResourceId: 9,
      savedResourceType: 'dashboard',
    }))).toMatchObject({ resourceType: 'dashboard' });
  });
});

describe('report fill P2 states', () => {
  it('validates typed template fields and detects publish revision conflicts', () => {
    const invalid = validateFillTemplateInput({
      code: 'sales_fill',
      name: '销售填报',
      formSchema: {
        fields: [{ key: '', label: '金额', type: 'number' }],
        settings: {},
      },
      needReview: false,
    }, false);
    expect(invalid.success).toBe(false);
    expect(isRevisionConflict(new ApiError(409, 'revision conflict'))).toBe(true);
    expect(isRevisionConflict(new ApiError(400, 'invalid'))).toBe(false);
  });

  it('gates the review tab and enforces the record FSM', () => {
    expect(shouldShowFillReviewTab(false)).toBe(false);
    expect(shouldShowFillReviewTab(true)).toBe(true);
    expect(canRunFillRecordAction(fillRecord(), 'edit')).toBe(true);
    expect(canRunFillRecordAction(fillRecord({ status: 'approved' }), 'edit')).toBe(false);
    expect(canRunFillRecordAction(fillRecord({
      status: 'submitted',
      templateNeedReview: true,
    }), 'review', true)).toBe(true);
    expect(canRunFillRecordAction(fillRecord({
      status: 'submitted',
      templateNeedReview: true,
      workflowInstanceId: 12,
    }), 'review', true)).toBe(false);
  });

  it('persists entry values before submitting the exact returned revision', async () => {
    const persist = vi.fn().mockResolvedValue({ id: 18, revision: 7 });
    const submitted = fillRecord({ id: 18, revision: 8, status: 'submitted' });
    const submit = vi.fn().mockResolvedValue(submitted);

    await expect(submitFillEntryValues({ amount: 99 }, persist, submit)).resolves.toBe(submitted);
    expect(persist).toHaveBeenCalledWith({ amount: 99 });
    expect(submit).toHaveBeenCalledWith(18, 7);
  });
});
