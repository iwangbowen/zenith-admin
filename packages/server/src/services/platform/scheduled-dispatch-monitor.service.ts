import type { JobSourceBreakdown, JobStuckItem } from '@zenith/shared/platform';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';
import { getChatScheduledHealth, listOverdueChatScheduled } from '../chat/chat-scheduled.service';
import { getChannelScheduledHealth, listOverdueChannelScheduled } from '../messaging/channel.service';
import { getCmsContentScheduledHealth, listOverdueCmsContentScheduled } from '../cms/cms-scheduled.service';
import { getCmsReleaseScheduledHealth, listOverdueCmsReleaseScheduled } from '../cms/cms-releases.service';
import { getCmsDistributionScheduledHealth, listOverdueCmsDistributionScheduled } from '../cms/cms-distributions-runs.service';
import { getMpScheduledHealth, listOverdueMpScheduled } from '../mp/mp-broadcast.service';
import { getWorkflowScheduledHealth, listOverdueWorkflowScheduled } from '../workflow/workflow-schedules.service';
import { getIotScheduledHealth, listOverdueIotScheduled } from '../iot/iot-schedules.service';
import { getReportSubscriptionScheduledHealth, listOverdueReportSubscriptionScheduled } from '../report/report-subscription.service';
import { getReportAlertScheduledHealth, listOverdueReportAlertScheduled } from '../report/report-alert.service';
import { getDirectoryScheduledHealth, listOverdueDirectoryScheduled } from '../identity/directory-sync-engine';

/** Every provider delegates to its domain's own tick condition; this aggregator never reads domain tables. */
const providers = [
  { key: 'chat-message', label: '聊天定时消息', collect: getChatScheduledHealth, list: listOverdueChatScheduled, path: '/chat' },
  { key: 'channel-message', label: '渠道定时消息', collect: getChannelScheduledHealth, list: listOverdueChannelScheduled, path: '/system/channels' },
  { key: 'cms-content', label: 'CMS 定时发布', collect: getCmsContentScheduledHealth, list: listOverdueCmsContentScheduled, path: '/cms/contents' },
  { key: 'cms-release', label: 'CMS 定时上线版本', collect: getCmsReleaseScheduledHealth, list: listOverdueCmsReleaseScheduled, path: '/cms/publishing' },
  { key: 'cms-distribution', label: 'CMS 分发规则', collect: getCmsDistributionScheduledHealth, list: listOverdueCmsDistributionScheduled, path: '/cms/distribution' },
  { key: 'mp-broadcast', label: '公众号定时群发', collect: getMpScheduledHealth, list: listOverdueMpScheduled, path: '/mp/broadcasts' },
  { key: 'workflow-schedule', label: '流程定时触发', collect: getWorkflowScheduledHealth, list: listOverdueWorkflowScheduled, path: '/workflow/schedules' },
  { key: 'iot-schedule', label: 'IoT 设备定时', collect: getIotScheduledHealth, list: listOverdueIotScheduled, path: '/iot/schedules' },
  { key: 'report-subscription', label: '报表订阅', collect: getReportSubscriptionScheduledHealth, list: listOverdueReportSubscriptionScheduled, path: '/report/subscriptions' },
  { key: 'report-alert', label: '报表预警', collect: getReportAlertScheduledHealth, list: listOverdueReportAlertScheduled, path: '/report/alerts' },
  { key: 'directory-schedule', label: '目录同步计划', collect: getDirectoryScheduledHealth, list: listOverdueDirectoryScheduled, path: '/system/directory-sync/sources' },
];

export async function getScheduledDispatchHealth(): Promise<JobSourceRawSummary> {
  const summaries = await Promise.all(providers.map(async provider => {
    try { return await provider.collect(); }
    catch (error) { throw new Error(`${provider.label}探测失败：${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  }));
  const breakdown: JobSourceBreakdown[] = providers.map((provider, i) => ({ key: provider.key, label: provider.label,
    pending: summaries[i].counts.pending, running: 0, stuck: summaries[i].counts.stuck, failed24h: 0,
    drillDown: { path: provider.path, label: '查看调度条目' },
  }));
  const ages = summaries.map(summary => summary.oldestPendingAgeSec).filter((age): age is number => age !== null);
  const pending = breakdown.reduce((total, item) => total + item.pending, 0);
  const stuck = breakdown.reduce((total, item) => total + item.stuck, 0);
  return { counts: { pending, running: 0, stuck, dead: null, failed24h: 0, succeeded24h: 0 },
    oldestPendingAgeSec: ages.length ? Math.max(...ages) : null, failed1h: 0, breakdown,
    issues: stuck > 0 ? [{ level: 'warn', message: `${stuck} 条调度已超期 3 分钟仍未处理` }] : [],
  };
}

export async function listStuckScheduledDispatch(limit: number): Promise<JobStuckItem[]> {
  const lists = await Promise.all(providers.map(provider => provider.list(limit)));
  return lists.flat().sort((a, b) => b.ageSec - a.ageSec || a.refId.localeCompare(b.refId)).slice(0, limit);
}
