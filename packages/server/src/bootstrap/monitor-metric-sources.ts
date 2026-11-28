import { getLogAlertMetrics } from '../lib/log-metrics';
import { countActiveWorkerNodes, getQueueBacklog } from '../lib/pg-boss-scheduler';
import { getReplayStorageMbMetric } from '../services/analytics/session-replays.service';
import { getOpenPlatformAlertMetrics } from '../services/open-platform/open-platform-alert-metrics.service';
import { getPaymentAlertMetrics } from '../services/payment/payment-alert-metrics.service';
import { getJobMonitorAlertMetrics } from '../services/platform/job-monitor-metrics.service';
import { registerMonitorMetricSource, sealMonitorMetricSources } from '../services/platform/monitor-alert-metrics';
import { INFRA_MONITOR_METRICS, getInfraMetricSnapshot } from '../services/platform/monitor-infra-metrics.service';
import { getLatestEngineHealthMetrics } from '../services/workflow/workflow-engine-ops.service';
import { getWorkflowJobAlertMetrics } from '../services/workflow/workflow-jobs.service';

export function registerMonitorMetricSources(): void {
  registerMonitorMetricSource({
    scope: 'global', metrics: INFRA_MONITOR_METRICS, read: getInfraMetricSnapshot,
  });
  registerMonitorMetricSource({ scope: 'global', metrics: ['logErrorPerMin', 'logWarnPerMin'], read: getLogAlertMetrics });
  registerMonitorMetricSource({
    scope: 'global', metrics: ['schedulerWorkerNodes'], read: async () => ({ schedulerWorkerNodes: await countActiveWorkerNodes() }),
  });
  registerMonitorMetricSource({
    scope: 'global', metrics: ['schedulerQueueBacklog'], read: async () => ({ schedulerQueueBacklog: await getQueueBacklog() }),
  });
  registerMonitorMetricSource({
    scope: 'global', metrics: ['jobsBacklog', 'jobsStuck', 'jobsDead', 'jobsFailed1h'], read: getJobMonitorAlertMetrics,
  });
  registerMonitorMetricSource({ scope: 'global', metrics: ['workflowHealth', 'workflowBacklog'], read: getLatestEngineHealthMetrics });
  registerMonitorMetricSource({
    scope: 'global', metrics: ['workflowDeadLetter', 'workflowFailureRate', 'workflowStuckRunning'], read: getWorkflowJobAlertMetrics,
  });
  registerMonitorMetricSource({
    scope: 'tenant',
    metrics: ['paymentFailureRate', 'paymentStuckPaying', 'paymentReconDiff', 'paymentEventBacklog', 'paymentWebhookFailureRate'],
    read: getPaymentAlertMetrics,
  });
  registerMonitorMetricSource({
    scope: 'global', metrics: ['openApiErrorRate', 'openApiAppErrorRate', 'openWebhookFailureRate', 'openWebhookDisabledSubs'],
    read: getOpenPlatformAlertMetrics,
  });
  registerMonitorMetricSource({
    scope: 'global', metrics: ['replayStorageMb'], read: async () => ({ replayStorageMb: await getReplayStorageMbMetric() }),
  });
  sealMonitorMetricSources();
}
