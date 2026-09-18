import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Breadcrumb, Button, Dropdown, Input, Select, Spin, Typography } from '@douyinfe/semi-ui';
import { ArrowLeft, Download, File, FileText, Folder, FolderOpen, History } from 'lucide-react';
import { request } from '@/utils/request';
import { logSourceDownloadUrl } from '@/hooks/queries/log-source';
import { logSourceKey, type LogSource } from '@/hooks/queries/log-source';
import { useLogFiles } from '@/hooks/queries/log-files';
import { HostSelector } from '@/components/HostSelector';
import { deriveInitialHostSelection, useOpsHostSelection } from '@/hooks/useOpsHostSelection';
import { usePermission } from '@/hooks/usePermission';
import { useHostFileHome, useHostFileList, useTerminalFileList, useTerminalRootInfo } from '@/hooks/queries/terminal-files';
import AppModal from '@/components/AppModal';
import { buildBreadcrumbs } from '@/pages/system/file-manager/fs-utils';
import { LogWorkbench } from '@/components/log-workbench/LogWorkbench';

const RECENT_PATHS_KEY = 'logViewer.recentPaths';
const MAX_RECENT_PATHS = 8;

const LINUX_COMMON_PATHS = [
  '/var/log/syslog',
  '/var/log/messages',
  '/var/log/auth.log',
  '/var/log/kern.log',
  '/var/log/nginx/access.log',
  '/var/log/nginx/error.log',
  '/var/log/apache2/access.log',
  '/var/log/apache2/error.log',
  '/var/log/mysql/error.log',
  '/var/log/redis/redis-server.log',
];

const WINDOWS_COMMON_SUFFIXES = [
  ['Windows\\Logs\\CBS\\CBS.log', 'CBS 系统组件日志'],
  ['Windows\\Logs\\DISM\\dism.log', 'DISM 部署日志'],
  ['Windows\\Panther\\setupact.log', '系统安装日志'],
  ['Windows\\Panther\\setuperr.log', '系统安装错误日志'],
] as const;

interface SubmittedLog {
  source: LogSource;
  /** 每次点「加载」递增：同一路径重复加载时重挂载工作台 */
  seq: number;
}

interface PickerEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
}

function LogPathPicker({
  visible,
  hostId,
  onCancel,
  onSelect,
}: Readonly<{
  visible: boolean;
  hostId: number | null;
  onCancel: () => void;
  onSelect: (path: string) => void;
}>) {
  const rootInfoQuery = useTerminalRootInfo();
  const hostHomeQuery = useHostFileHome(hostId ?? 0, visible && hostId != null);
  const [currentPath, setCurrentPath] = useState('');

  useEffect(() => {
    if (!visible) return;
    const initial = hostId == null ? rootInfoQuery.data?.home : hostHomeQuery.data?.home;
    if (initial && !currentPath) setCurrentPath(initial);
  }, [currentPath, hostHomeQuery.data?.home, hostId, rootInfoQuery.data?.home, visible]);

  const localListQuery = useTerminalFileList(currentPath, visible && hostId == null && currentPath !== '');
  const hostListQuery = useHostFileList(hostId ?? 0, currentPath, visible && hostId != null && currentPath !== '');
  const listing = hostId == null ? localListQuery.data : hostListQuery.data;
  const entries: PickerEntry[] = (listing?.entries ?? []).map((entry) => ({
    name: entry.name,
    path: entry.path,
    type: entry.type === 'dir' ? 'dir' as const : 'file' as const,
  })).sort((a, b) => Number(b.type === 'dir') - Number(a.type === 'dir') || a.name.localeCompare(b.name));
  const loading = rootInfoQuery.isFetching || hostHomeQuery.isFetching || localListQuery.isFetching || hostListQuery.isFetching;
  const windowsDrives = hostId == null && rootInfoQuery.data?.isWindows ? rootInfoQuery.data.drives : [];
  const currentDrive = currentPath.match(/^([A-Za-z]:)/)?.[1] ?? windowsDrives[0] ?? '';
  const breadcrumbs = currentPath ? buildBreadcrumbs(currentPath) : [];

  const close = () => {
    setCurrentPath('');
    onCancel();
  };

  return (
    <AppModal title="选择日志文件" visible={visible} onCancel={close} footer={null} width={620}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {windowsDrives.length > 0 && (
          <Select
            size="small"
            value={currentDrive}
            optionList={windowsDrives.map((drive) => ({ value: drive.replace(/[\\/]+$/, ''), label: `${drive.replace(/[\\/]+$/, '')} 盘` }))}
            onChange={(value) => setCurrentPath(`${String(value).replace(/[\\/]+$/, '')}\\`)}
            style={{ width: 92 }}
            aria-label="选择磁盘"
          />
        )}
        <Button size="small" icon={<ArrowLeft size={13} />} disabled={!listing?.parent} onClick={() => listing?.parent && setCurrentPath(listing.parent)}>
          上级
        </Button>
        <Breadcrumb compact style={{ flex: 1, minWidth: 0 }} showTooltip={{ width: 320 }}>
          {breadcrumbs.map((crumb, index) => {
            const clickable = index < breadcrumbs.length - 1;
            return (
              <Breadcrumb.Item
                key={crumb.path}
                onClick={clickable ? () => setCurrentPath(crumb.path) : undefined}
                style={{
                  cursor: clickable ? 'pointer' : 'default',
                  color: clickable ? 'var(--semi-color-primary)' : undefined,
                  fontFamily: 'monospace',
                  fontSize: 12,
                }}
              >
                {crumb.label}
              </Breadcrumb.Item>
            );
          })}
        </Breadcrumb>
      </div>
      <div style={{ minHeight: 300, maxHeight: 420, overflowY: 'auto', borderTop: '1px solid var(--semi-color-border)' }}>
        {loading && !listing ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spin /></div>
        ) : entries.length === 0 ? (
          <Typography.Text type="tertiary" style={{ display: 'block', padding: 32, textAlign: 'center' }}>此目录没有可选文件</Typography.Text>
        ) : entries.map((entry) => (
          <Button
            key={entry.path}
            theme="borderless"
            block
            style={{ justifyContent: 'flex-start', height: 36, padding: '0 10px' }}
            icon={entry.type === 'dir' ? <Folder size={14} /> : <File size={14} />}
            onClick={() => entry.type === 'dir' ? setCurrentPath(entry.path) : (onSelect(entry.path), close())}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
          </Button>
        ))}
      </div>
    </AppModal>
  );
}

function readRecentPaths(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_PATHS_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT_PATHS) : [];
  } catch {
    return [];
  }
}

export default function LogViewerPage() {
  const { hasPermission } = usePermission();
  const [filePath, setFilePath] = useState('');
  const [projectFile, setProjectFile] = useState('');
  const [recentPaths, setRecentPaths] = useState<string[]>(readRecentPaths);
  const [submitted, setSubmitted] = useState<SubmittedLog | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // 显式 ?path= 且无 hostId 的站内深链必须落本机，不能被上一次远端主机选择污染。
  const [hostId, setHostId] = useOpsHostSelection(deriveInitialHostSelection(searchParams, 'path'));
  const [downloading, setDownloading] = useState(false);
  const [pathPickerVisible, setPathPickerVisible] = useState(false);
  const canUseProjectLogs = hostId == null && hasPermission('system:log:files');
  const canBrowseFiles = hasPermission('system:file:use') || hasPermission('system:terminal:execute');
  const rootInfoQuery = useTerminalRootInfo(canBrowseFiles);
  const projectLogsQuery = useLogFiles(canUseProjectLogs);
  const projectLogs = projectLogsQuery.data ?? [];

  // 深链：?path= 直接加载指定日志，消费后清空参数。
  useEffect(() => {
    const path = searchParams.get('path');
    if (!path) return;
    const source: LogSource = { kind: 'path', path, hostId };
    setFilePath(path);
    setSubmitted((prev) => ({ source, seq: (prev?.seq ?? 0) + 1 }));
    setSearchParams(hostId == null ? {} : { hostId: String(hostId) }, { replace: true });
  }, [searchParams, setSearchParams, hostId]);

  const rememberPath = useCallback((path: string) => {
    const next = [path, ...recentPaths.filter((item) => item !== path)].slice(0, MAX_RECENT_PATHS);
    setRecentPaths(next);
    try {
      localStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  }, [recentPaths]);

  const loadSource = useCallback((source: LogSource, remember = false) => {
    if (remember && source.kind === 'path') rememberPath(source.path);
    setSubmitted((prev) => ({ source, seq: (prev?.seq ?? 0) + 1 }));
  }, [rememberPath]);

  const loadExternalPath = useCallback(() => {
    const path = filePath.trim();
    if (!path) return;
    loadSource({ kind: 'path', path, hostId }, true);
  }, [filePath, hostId, loadSource]);

  const handleDownload = useCallback(async (target: SubmittedLog) => {
    setDownloading(true);
    try {
      const name = target.source.kind === 'file'
        ? target.source.filename
        : target.source.path.split(/[\\/]/).pop() || 'log.txt';
      await request.download(logSourceDownloadUrl(target.source), name);
    } finally {
      setDownloading(false);
    }
  }, []);

  const handleHostChange = useCallback((next: number | null) => {
    setHostId(next);
    setSubmitted(null);
    setProjectFile('');
  }, [setHostId]);

  const source = submitted?.source ?? null;
  const currentProjectFile = source?.kind === 'file' ? source.filename : projectFile;
  const pathPlaceholder = hostId == null ? '输入当前服务端上的绝对路径' : '输入远端主机上的绝对路径';
  const commonPathOptions = useMemo(() => {
    if (hostId != null || rootInfoQuery.data?.isWindows === false) {
      return LINUX_COMMON_PATHS.map((path) => ({ value: path, label: path }));
    }
    const drives = rootInfoQuery.data?.drives ?? ['C:'];
    return drives.flatMap((drive) => WINDOWS_COMMON_SUFFIXES.map(([suffix, label]) => ({
      value: `${drive.replace(/[\\/]+$/, '')}\\${suffix}`,
      label: `${drive} · ${label}`,
    })));
  }, [hostId, rootInfoQuery.data]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '12px 16px', gap: 12 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        minHeight: 32,
      }}>
        <HostSelector value={hostId} onChange={handleHostChange} size="small" style={{ width: 180 }} />
        <Select
          size="small"
          value={currentProjectFile || undefined}
          placeholder={hostId != null ? '本机项目日志' : projectLogsQuery.isFetching ? '读取项目日志…' : '项目日志'}
          loading={projectLogsQuery.isFetching}
          disabled={!canUseProjectLogs || projectLogs.length === 0}
          onChange={(value) => {
            const filename = value as string;
            setProjectFile(filename);
            loadSource({ kind: 'file', filename });
          }}
          optionList={projectLogs.map((file) => ({ value: file.name, label: `${file.name}${file.isGzip ? ' · 压缩归档' : ''}` }))}
          style={{ width: 220 }}
          aria-label="选择项目日志"
        />
        <span style={{ width: 1, height: 20, margin: '0 2px', background: 'var(--semi-color-border)' }} />
        <Input
          size="small"
          prefix={<FolderOpen size={13} />}
          placeholder={pathPlaceholder}
          value={filePath}
          onChange={setFilePath}
          showClear
          onEnterPress={loadExternalPath}
          style={{ flex: '1 1 280px', minWidth: 220 }}
          aria-label="输入日志路径"
        />
        <Dropdown
          trigger="click"
          position="bottomRight"
          render={(
            <Dropdown.Menu>
              <Dropdown.Item disabled>常用路径{rootInfoQuery.isFetching ? '（识别中…）' : ''}</Dropdown.Item>
              {commonPathOptions.map((option) => (
                <Dropdown.Item key={option.value} onClick={() => setFilePath(option.value)}>{option.label}</Dropdown.Item>
              ))}
              {recentPaths.length > 0 && (
                <>
                  <Dropdown.Divider />
                  <Dropdown.Item disabled>最近使用</Dropdown.Item>
                  {recentPaths.map((path) => (
                    <Dropdown.Item key={path} onClick={() => setFilePath(path)}>
                      <span style={{ display: 'block', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path}</span>
                    </Dropdown.Item>
                  ))}
                </>
              )}
            </Dropdown.Menu>
          )}
        >
          <Button size="small" icon={<History size={13} />} aria-label="常用和最近路径">路径预设</Button>
        </Dropdown>
        <Button size="small" icon={<FolderOpen size={13} />} onClick={() => setPathPickerVisible(true)} disabled={!canBrowseFiles}>
          浏览
        </Button>
        <Button size="small" type="primary" onClick={loadExternalPath} disabled={!filePath.trim()}>
          加载
        </Button>
      </div>
      {canBrowseFiles && <LogPathPicker
        visible={pathPickerVisible}
        hostId={hostId}
        onCancel={() => setPathPickerVisible(false)}
        onSelect={(path) => {
          setFilePath(path);
          loadSource({ kind: 'path', path, hostId }, true);
        }}
      />}

      <div style={{
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
        border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)',
        overflow: 'hidden', background: 'var(--surface-card)',
      }}>
        {submitted && source ? (
          <LogWorkbench
            key={`${logSourceKey(source)}|${submitted.seq}`}
            source={source}
            title={(
              <>
                <FileText size={14} style={{ flexShrink: 0, color: 'var(--semi-color-primary)' }} />
                <Typography.Text style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>
                  {source.kind === 'file' ? source.filename : source.path}
                </Typography.Text>
              </>
            )}
            menuExtra={(
              <Dropdown.Item disabled={downloading} onClick={() => void handleDownload(submitted)}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={14} /> 下载</span>
              </Dropdown.Item>
            )}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <FileText size={40} style={{ color: 'var(--semi-color-text-3)' }} />
            <Typography.Text type="tertiary">从上方选择当前项目日志，或输入其他日志的完整路径</Typography.Text>
          </div>
        )}
      </div>
    </div>
  );
}
