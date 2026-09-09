import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Dropdown, Input, Select, Typography } from '@douyinfe/semi-ui';
import { Download, FolderOpen, FileText } from 'lucide-react';
import { request } from '@/utils/request';
import { logViewerDownloadUrl, useLogViewerRoots } from '@/hooks/queries/log-viewer';
import { logSourceKey, type LogSource } from '@/hooks/queries/log-source';
import { HostSelector } from '@/components/HostSelector';
import { useOpsHostSelection } from '@/hooks/useOpsHostSelection';
import { LogWorkbench } from '@/components/log-workbench/LogWorkbench';

/** 常用日志路径 */
const COMMON_LOG_PATHS = [
  '/var/log/syslog',
  '/var/log/messages',
  '/var/log/auth.log',
  '/var/log/kern.log',
  '/var/log/nginx/access.log',
  '/var/log/nginx/error.log',
  '/var/log/apache2/access.log',
  '/var/log/apache2/error.log',
  '/var/log/mysql/error.log',
  '/var/log/postgresql/postgresql.log',
  '/var/log/redis/redis-server.log',
];

interface SubmittedLog {
  path: string;
  hostId: number | null;
  /** 每次点「加载」递增：同一路径重复加载时重挂载工作台（停掉追踪、重新回源） */
  seq: number;
}

export default function LogViewerPage() {
  const [filePath, setFilePath] = useState('');
  const [submitted, setSubmitted] = useState<SubmittedLog | null>(null);
  // 深链:?path= 直接加载指定日志(Nginx 站点页等跳入),消费后清空参数
  const [searchParams, setSearchParams] = useSearchParams();
  const initialHostId = (() => {
    const value = Number(searchParams.get('hostId'));
    return Number.isInteger(value) && value > 0 ? value : null;
  })();
  // 显式 ?path= 且无 hostId 的站内深链（如本机 Nginx 日志）必须落本机，
  // 不能被上一次持久化的远端主机选择污染。
  const [hostId, setHostId] = useOpsHostSelection(
    searchParams.has('hostId') ? initialHostId : searchParams.has('path') ? null : undefined,
  );
  useEffect(() => {
    const p = searchParams.get('path');
    if (!p) return;
    setFilePath(p);
    setSubmitted((prev) => ({ path: p, hostId, seq: (prev?.seq ?? 0) + 1 }));
    setSearchParams(hostId == null ? {} : { hostId: String(hostId) }, { replace: true });
  }, [searchParams, setSearchParams, hostId]);
  const rootsQuery = useLogViewerRoots(hostId ?? undefined);
  const [downloading, setDownloading] = useState(false);

  const loadContent = useCallback(() => {
    const path = filePath.trim();
    if (!path) return;
    setSubmitted((prev) => ({ path, hostId, seq: (prev?.seq ?? 0) + 1 }));
  }, [filePath, hostId]);

  const handleDownload = useCallback(async (target: SubmittedLog) => {
    setDownloading(true);
    try {
      const name = target.path.split('/').pop() || 'log.txt';
      await request.download(logViewerDownloadUrl(target.path, target.hostId), name);
    } finally {
      setDownloading(false);
    }
  }, []);

  const source: LogSource | null = submitted ? { kind: 'path', path: submitted.path, hostId: submitted.hostId } : null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '12px 16px', gap: 12 }}>
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileText size={18} style={{ color: 'var(--semi-color-primary)' }} />
        <Typography.Title heading={6} style={{ margin: 0 }}>日志查看器</Typography.Title>
        <HostSelector
          value={hostId}
          onChange={(next) => {
            setHostId(next);
            setSubmitted(null);
          }}
        />
      </div>

      {/* 文件路径区 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <Typography.Text size="small" type="secondary" style={{ display: 'block', marginBottom: 4 }}>
            日志文件路径
            {rootsQuery.data && (
              <span style={{ marginLeft: 8 }}>
                （仅允许：{rootsQuery.data.roots.length > 0 ? rootsQuery.data.roots.join('、') : '未配置 LOG_VIEWER_ROOTS'}）
              </span>
            )}
          </Typography.Text>
          <Input
            prefix={<FolderOpen size={13} />}
            placeholder="/var/log/syslog"
            value={filePath}
            onChange={setFilePath}
            showClear
            onEnterPress={loadContent}
          />
        </div>
        <div style={{ minWidth: 200 }}>
          <Typography.Text size="small" type="secondary" style={{ display: 'block', marginBottom: 4 }}>常用路径</Typography.Text>
          <Select
            placeholder="选择常用路径"
            onChange={(v) => setFilePath(v as string)}
            style={{ width: '100%' }}
            optionList={COMMON_LOG_PATHS.map((p) => ({ value: p, label: p.split('/').pop() ?? p }))}
          />
        </div>
        <Button type="primary" icon={<FolderOpen size={13} />} onClick={loadContent} disabled={!filePath.trim()}>
          加载
        </Button>
      </div>

      {/* 日志工作台：与「日志文件」页面共用同一查看器（搜索 / 级别 / 实时追踪 / 复制导出） */}
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--semi-color-border)',
        borderRadius: 'var(--semi-border-radius-medium)',
        overflow: 'hidden',
        background: 'var(--surface-card)',
      }}>
        {submitted && source ? (
          <LogWorkbench
            key={`${logSourceKey(source)}|${submitted.seq}`}
            source={source}
            title={(
              <>
                <FileText size={14} style={{ flexShrink: 0, color: 'var(--semi-color-primary)' }} />
                <Typography.Text style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>
                  {submitted.path}
                </Typography.Text>
              </>
            )}
            menuExtra={(
              <Dropdown.Item disabled={downloading} onClick={() => void handleDownload(submitted)}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Download size={14} /> 下载
                </span>
              </Dropdown.Item>
            )}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <FileText size={40} style={{ color: 'var(--semi-color-text-3)' }} />
            <Typography.Text type="tertiary">请输入日志文件路径并点击「加载」</Typography.Text>
          </div>
        )}
      </div>
    </div>
  );
}
