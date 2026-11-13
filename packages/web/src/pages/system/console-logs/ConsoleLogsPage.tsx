import { useId } from 'react';
import { Button, Select, Spin, Typography } from '@douyinfe/semi-ui';
import { RefreshCw, Terminal } from 'lucide-react';
import { CONSOLE_LOG_ROLE_OPTIONS, type ConsoleLogRole } from '@zenith/shared/ops';
import { LogWorkbench } from '@/components/log-workbench/LogWorkbench';
import type { LogLevel } from '@/components/log-workbench/log-search';
import { useConsoleLogSources } from '@/hooks/queries/console-logs';
import { logSourceKey, type LogSource } from '@/hooks/queries/log-source';
import { useUrlSelectionParams } from '@/hooks/useUrlSelectionState';
import './ConsoleLogsPage.css';

function parseLevel(value: string | null): LogLevel | undefined {
  return value === 'error' || value === 'warn' || value === 'info' || value === 'debug' ? value : undefined;
}

export default function ConsoleLogsPage() {
  const roleLabelId = useId();
  const sourcesQuery = useConsoleLogSources();
  const [selection, setSelection] = useUrlSelectionParams(['role', 'level', 'keyword', 'correlationId'], { replaceOnNavigate: true });
  const data = sourcesQuery.data;
  const roles = data?.sources ?? [];
  // 无选择时直接派生当前角色，不把异步默认值写入 URL。
  const role = roles.find((item) => item.role === selection.role)?.role ?? data?.currentRole;
  const source: LogSource | undefined = role ? { kind: 'console', role } : undefined;
  const initialCorrelationId = selection.correlationId && /^[\w-]{8,64}$/.test(selection.correlationId) ? selection.correlationId : undefined;
  const initialKeyword = selection.keyword?.trim().slice(0, 200) || undefined;

  return (
    <div className="console-logs-page">
      <div className="console-logs-page__header">
        <Terminal size={18} />
        <Typography.Title heading={5} style={{ margin: 0 }}>控制台日志</Typography.Title>
        {data && (
          <>
            <Typography.Text id={roleLabelId}>日志来源</Typography.Text>
            <Select
              aria-labelledby={roleLabelId}
              size="small"
              value={role}
              optionList={CONSOLE_LOG_ROLE_OPTIONS.filter((option) => roles.some((item) => item.role === option.value))}
              onChange={(value) => setSelection({ role: value as ConsoleLogRole, level: null, keyword: null, correlationId: null })}
              style={{ width: 170 }}
            />
            <Typography.Text type="tertiary" className="console-logs-page__instance">
              当前后端实例：{data.hostname} · PID {data.pid}
            </Typography.Text>
          </>
        )}
      </div>
      <Typography.Text type="tertiary" size="small">
        展示后端自身的运行输出，可查看当前后端日志目录内的各角色日志。
      </Typography.Text>
      <div className="console-logs-page__workbench">
        {sourcesQuery.isPending ? (
          <div className="console-logs-page__placeholder"><Spin size="large" /></div>
        ) : sourcesQuery.isError ? (
          <div className="console-logs-page__placeholder">
            <Typography.Text type="tertiary">日志来源加载失败</Typography.Text>
            <Button size="small" theme="light" icon={<RefreshCw size={14} />} loading={sourcesQuery.isFetching} onClick={() => void sourcesQuery.refetch()}>重试</Button>
          </div>
        ) : source ? (
          <LogWorkbench
            key={`${logSourceKey(source)}|${initialCorrelationId ?? ''}|${selection.level ?? ''}|${initialKeyword ?? ''}`}
            source={source}
            // 链路深链先显示历史定位窗口，用户可手动切换到实时追踪。
            autoTail={!initialCorrelationId}
            initialLevel={parseLevel(selection.level)}
            initialKeyword={initialKeyword}
            initialCorrelationId={initialCorrelationId}
            onCorrelationIdChange={(correlationId) => setSelection((prev) => ({ ...prev, correlationId: correlationId ?? null }))}
          />
        ) : (
          <div className="console-logs-page__placeholder"><Typography.Text type="tertiary">暂无可用的后端日志来源</Typography.Text></div>
        )}
      </div>
    </div>
  );
}
