import { useState } from 'react';
import { Button, Tag, Tooltip } from '@douyinfe/semi-ui';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag/interface';
import type { CronJobAlert, CronAlertLevel } from '@zenith/shared/platform';
import { CRON_ALERT_TYPE_LABELS } from '@zenith/shared/platform';

const COLLAPSED_LIMIT = 6;

const LEVEL_TAG: Record<CronAlertLevel, TagColor> = {
  danger: 'red',
  warning: 'orange',
  info: 'grey',
};

interface Props {
  readonly alerts: readonly CronJobAlert[];
  readonly canExecute: boolean;
  readonly onViewLogs: (jobId: number, jobName: string) => void;
  readonly onRun: (jobId: number, jobName: string) => void;
}

/** 结构化健康提醒：级别 · 类型 · 任务 · 指标 · 内联操作，超过阈值折叠 */
export function CronJobAlertsPanel({ alerts, canExecute, onViewLogs, onRun }: Props) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? alerts : alerts.slice(0, COLLAPSED_LIMIT);
  return (
    <div className="cron-alerts">
      {visible.map((alert) => (
        <div key={`${alert.type}-${alert.jobId}`} className="cron-alert">
          <span className={`cron-alert__level cron-alert__level--${alert.level}`} />
          <Tag color={LEVEL_TAG[alert.level]} size="small" type="light">{CRON_ALERT_TYPE_LABELS[alert.type]}</Tag>
          <span className="cron-alert__job" title={alert.jobName}>{alert.jobName}</span>
          <Tooltip content={alert.detail ? `${alert.message} · ${alert.detail}` : alert.message} position="top">
            <span className="cron-alert__text">
              {alert.message}
              {alert.detail && <span className="cron-alert__detail"> · {alert.detail}</span>}
            </span>
          </Tooltip>
          <span className="cron-alert__actions">
            <Button size="small" theme="borderless" onClick={() => onViewLogs(alert.jobId, alert.jobName)}>日志</Button>
            {canExecute && alert.type !== 'running_timeout' && (
              <Button size="small" theme="borderless" onClick={() => onRun(alert.jobId, alert.jobName)}>执行</Button>
            )}
          </span>
        </div>
      ))}
      {alerts.length > COLLAPSED_LIMIT && (
        <div className="cron-alerts__more">
          <Button size="small" theme="borderless" type="tertiary" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起' : `展开全部 ${alerts.length} 条`}
          </Button>
        </div>
      )}
    </div>
  );
}
