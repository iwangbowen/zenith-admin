import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());

describe('monitor alert metric sources', () => {
  it('only reads the heartbeat for Worker watchdog rules and preserves zero', async () => {
    const { registerMonitorMetricSource, collectMonitorMetrics } = await import('./monitor-alert-metrics');
    const heartbeat = vi.fn(() => ({ schedulerWorkerNodes: 0 }));
    const queue = vi.fn(() => ({ schedulerQueueBacklog: 20 }));
    const workflow = vi.fn(() => ({ workflowHealth: 100 }));
    const payment = vi.fn(() => ({ paymentFailureRate: 30 }));
    registerMonitorMetricSource({ scope: 'global', metrics: ['schedulerWorkerNodes'], read: heartbeat });
    registerMonitorMetricSource({ scope: 'global', metrics: ['schedulerQueueBacklog'], read: queue });
    registerMonitorMetricSource({ scope: 'global', metrics: ['workflowHealth'], read: workflow });
    registerMonitorMetricSource({ scope: 'tenant', metrics: ['paymentFailureRate'], read: payment });

    expect(await collectMonitorMetrics([{ metric: 'schedulerWorkerNodes', tenantId: null }]))
      .toEqual(new Map([[null, { schedulerWorkerNodes: 0 }]]));
    expect(heartbeat).toHaveBeenCalledOnce();
    expect(queue).not.toHaveBeenCalled();
    expect(workflow).not.toHaveBeenCalled();
    expect(payment).not.toHaveBeenCalled();
  });

  it('shares global reads and isolates failure to the source and requested tenant', async () => {
    const { registerMonitorMetricSource, collectMonitorMetrics } = await import('./monitor-alert-metrics');
    const workflow = vi.fn(() => ({ workflowHealth: 100, workflowBacklog: 0 }));
    const payment = vi.fn(async (tenantId: number | null) => {
      if (tenantId === 2) throw new Error('payment query failed');
      return { paymentFailureRate: tenantId ?? 30, paymentStuckPaying: 1 };
    });
    registerMonitorMetricSource({ scope: 'global', metrics: ['workflowHealth', 'workflowBacklog'], read: workflow });
    registerMonitorMetricSource({ scope: 'tenant', metrics: ['paymentFailureRate', 'paymentStuckPaying'], read: payment });

    const results = await collectMonitorMetrics([
      { metric: 'workflowHealth', tenantId: 1 },
      { metric: 'workflowBacklog', tenantId: 2 },
      { metric: 'paymentFailureRate', tenantId: 1 },
      { metric: 'paymentStuckPaying', tenantId: 1 },
      { metric: 'paymentFailureRate', tenantId: 2 },
      { metric: 'paymentFailureRate', tenantId: null },
    ]);
    expect(workflow).toHaveBeenCalledOnce();
    expect(payment.mock.calls).toEqual([[1], [2], [null]]);
    expect(results).toEqual(new Map([
      [1, { workflowHealth: 100, paymentFailureRate: 1, paymentStuckPaying: 1 }],
      [2, { workflowBacklog: 0, paymentFailureRate: null }],
      [null, { paymentFailureRate: 30 }],
    ]));
  });

  it('reports invalid scope, duplicate sources and missing metric names at composition time', async () => {
    const { registerMonitorMetricSource, sealMonitorMetricSources } = await import('./monitor-alert-metrics');
    expect(() => registerMonitorMetricSource({ scope: 'global', metrics: ['paymentFailureRate'], read: () => ({}) }))
      .toThrow('paymentFailureRate');
    const cpu = { scope: 'global', metrics: ['cpu'], read: () => ({ cpu: 0 }) } as const;
    registerMonitorMetricSource(cpu);
    expect(() => registerMonitorMetricSource(cpu)).toThrow('cpu');
    expect(() => sealMonitorMetricSources()).toThrow('schedulerWorkerNodes');
  });
});
