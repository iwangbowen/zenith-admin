import { analyticsCampaignContract } from '@zenith/shared/analytics';
import { traceContract, type TraceFailureEntry, type TraceTimelineNode } from '@zenith/shared/platform';
import { urlOf } from '@/lib/contract-query';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '../utils/date';

/** Demo 模式演示时间线：覆盖五类节点与全部状态形态 */
function buildDemoNodes(): TraceTimelineNode[] {
  const ts = mockDateTime();
  return [
    {
      kind: 'request', ts, title: `POST ${urlOf(analyticsCampaignContract.executeCampaign, { params: { id: 1 } })}`, status: 'success',
      durationMs: 128, refId: 1001,
      detail: { description: '执行触达活动', module: '分群触达', username: 'admin', responseCode: 200, ip: '127.0.0.1', hasDiff: false },
    },
    {
      kind: 'task', ts, title: '触达活动执行', status: 'success', durationMs: 2350, refId: 88,
      detail: { taskType: 'analytics-campaign-execute', processedCount: 156, totalCount: 156, failedCount: 0, progressNote: '已全部发送', attempts: 1 },
    },
    {
      kind: 'event', ts, title: 'analytics.campaign.executed', status: 'success', durationMs: null, refId: 501,
      detail: { eventId: 'demo-event-1', attempts: 1, payload: { type: 'analytics.campaign.executed', campaignId: 1 } },
    },
    {
      kind: 'notification', ts, title: 'analytics.campaign.finished', status: 'success', durationMs: null, refId: 301,
      detail: {
        eventKey: 'analytics.campaign.finished', recipientCount: 1, attempts: 1, lastError: null,
        dispatches: [
          { channel: 'inApp', decision: 'sent', reasonCode: null, recipientType: 'user', recipientId: 1 },
          { channel: 'email', decision: 'suppressed', reasonCode: 'channel_disabled', recipientType: 'user', recipientId: 1 },
        ],
      },
    },
    {
      kind: 'job', ts, title: 'webhook_delivery', status: 'failed', durationMs: null, refId: 601,
      detail: { jobType: 'webhook_delivery', attempts: 3, maxAttempts: 3, lastError: '目标地址连接超时', runAt: ts },
    },
  ];
}

function buildDemoFailures(): TraceFailureEntry[] {
  return [
    { kind: 'job', refId: 601, traceId: 'demo-trace-failed-0001', title: 'webhook_delivery', error: '死信：目标地址连接超时', ts: mockDateTime() },
    { kind: 'task', refId: 89, traceId: 'demo-trace-failed-0002', title: '数据导入', error: '第 12 行手机号格式不合法', ts: mockDateTime() },
    { kind: 'request', refId: 1002, traceId: 'demo-trace-failed-0003', title: 'POST /api/payment/refunds', error: '发起退款（HTTP 500）', ts: mockDateTime() },
  ];
}

export const traceHandlers = [
  mock(traceContract.recentFailures, ({ ok }) => ok(buildDemoFailures())),
  mock(traceContract.timeline, ({ params, ok }) => ok({ traceId: params.traceId, nodes: buildDemoNodes() })),
];
