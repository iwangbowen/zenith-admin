import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Empty, Progress, Spin, Switch, Tooltip, Typography } from '@douyinfe/semi-ui';
import { Building2, Clock, HardDrive, Link2, Plus, Share2, Star, Trash2, Users } from 'lucide-react';
import { formatBytes } from '@zenith/shared/core';
import { DRIVE_VIEW_LABELS, type DriveSpace, type DriveSpaceType, type DriveView } from '@zenith/shared/drive';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { KeywordInput } from '@/components/search-filters';
import { useUrlSelectionParams } from '@/hooks/useUrlSelectionState';
import { usePermission } from '@/hooks/usePermission';
import { useDriveSettings, useMyDriveSpaces } from '@/hooks/queries/drive';
import { useNavigate } from 'react-router-dom';
import { fetchManagedFileBlob } from '@/utils/file-utils';
import { downloadBlob } from '@/utils/download';
import { DriveBrowser } from './components/DriveBrowser';
import { DriveNodeDrawer } from './components/DriveNodeDrawer';
import { DriveUploadQueue } from './components/DriveUploadQueue';
import { DriveSearchView, DriveViews } from './components/DriveViews';
import { useDriveUploader } from './hooks/useDriveUploader';
import { nodeDownloadUrl, usagePercent } from './drive-utils';
import './drive.css';

const SPACE_ICONS: Record<DriveSpaceType, typeof HardDrive> = { personal: HardDrive, department: Building2, team: Users };
const VIEW_ICONS: Record<Exclude<DriveView, 'space'>, typeof Star> = { shared: Share2, starred: Star, recent: Clock, recycle: Trash2, links: Link2 };
const VIEW_ORDER: Array<Exclude<DriveView, 'space'>> = ['shared', 'starred', 'recent', 'links', 'recycle'];

function SpaceItem({ space, active, onClick }: { readonly space: DriveSpace; readonly active: boolean; readonly onClick: () => void }) {
  const Icon = SPACE_ICONS[space.type];
  const pct = usagePercent(space);
  return (
    <button type="button" className={`drive-nav__item${active ? ' drive-nav__item--active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <Icon size={16} className="drive-nav__icon" />
      <span className="drive-nav__label">
        <Typography.Text ellipsis={{ showTooltip: true }} className="drive-nav__name">{space.name}</Typography.Text>
        <span className="drive-nav__meta">
          {formatBytes(space.usedBytes)}{space.quotaBytes ? ` / ${formatBytes(space.quotaBytes)}` : ''}
        </span>
        {pct !== null && <Progress percent={pct} size="small" showInfo={false} stroke={pct >= 90 ? 'var(--semi-color-danger)' : undefined} aria-label={`${space.name} 用量 ${pct}%`} />}
      </span>
    </button>
  );
}

export default function DriveWorkbenchPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const [selection, setSelection] = useUrlSelectionParams(['view', 'space', 'folder']);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [globalKeyword, setGlobalKeyword] = useState('');
  const [searching, setSearching] = useState<{ keyword: string; fullText: boolean } | null>(null);
  const [fullText, setFullText] = useState(false);
  const [showDetailOnNarrow, setShowDetailOnNarrow] = useState(false);

  const spacesQuery = useMyDriveSpaces();
  const settingsQuery = useDriveSettings(hasPermission('drive:setting:view'));
  const uploader = useDriveUploader();

  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const view = (VIEW_ORDER as string[]).includes(selection.view ?? '') ? (selection.view as Exclude<DriveView, 'space'>) : 'space';
  const spaceId = selection.space ? Number(selection.space) : null;
  const folderId = selection.folder ? Number(selection.folder) : null;

  // 默认落到个人空间；URL 指向的空间不存在时回退（列表落定后再判定）
  const activeSpace = useMemo(() => spaces.find((s) => s.id === spaceId) ?? null, [spaces, spaceId]);
  useEffect(() => {
    if (view !== 'space' || spacesQuery.isPending) return;
    if (spaceId && activeSpace) return;
    const fallback = spaces.find((s) => s.type === 'personal') ?? spaces[0];
    if (fallback && fallback.id !== spaceId) setSelection({ view: null, space: String(fallback.id), folder: null });
  }, [view, spaceId, activeSpace, spaces, spacesQuery.isPending, setSelection]);

  const openSpace = useCallback((id: number, folder: number | null = null) => {
    setSearching(null);
    setSelection({ view: null, space: String(id), folder: folder ? String(folder) : null });
    setShowDetailOnNarrow(true);
  }, [setSelection]);
  const openView = (v: Exclude<DriveView, 'space'>) => {
    setSearching(null);
    setSelection({ view: v, space: null, folder: null });
    setShowDetailOnNarrow(true);
  };
  const navigateFolder = useCallback((folder: number | null) => {
    setSelection((prev) => ({ ...prev, folder: folder ? String(folder) : null }));
  }, [setSelection]);

  const allowExternalShare = (settingsQuery.data?.effective.externalShareEnabled ?? true) && (activeSpace?.allowExternalShare ?? true);

  const quickCreateTeamSpace = () => navigate('/drive/spaces?create=1');

  const master = (
    <>
      <MasterDetailLayout.Header extra={hasPermission('drive:space:create') ? (
        <Tooltip content="新建协作空间"><Button size="small" theme="borderless" icon={<Plus size={14} />} aria-label="新建协作空间" onClick={quickCreateTeamSpace} /></Tooltip>
      ) : undefined}>
        <Typography.Text strong>企业网盘</Typography.Text>
      </MasterDetailLayout.Header>
      <MasterDetailLayout.Body padding={8}>
        <div className="drive-nav__search">
          <KeywordInput value={globalKeyword} width="100%" placeholder="搜索全部文件…" onChange={setGlobalKeyword}
            onSearch={() => { if (globalKeyword.trim()) { setSearching({ keyword: globalKeyword.trim(), fullText }); setShowDetailOnNarrow(true); } }} />
          <label className="drive-nav__fulltext">
            <Switch size="small" checked={fullText} onChange={setFullText} aria-label="包含正文" />
            <span>包含正文</span>
          </label>
        </div>
        <div className="drive-nav__section">我的空间</div>
        {spacesQuery.isPending ? <Spin /> : spaces.length === 0 ? <Empty description="暂无可访问的空间" style={{ padding: 16 }} /> : (
          spaces.map((s) => <SpaceItem key={s.id} space={s} active={view === 'space' && !searching && s.id === spaceId} onClick={() => openSpace(s.id)} />)
        )}
        <div className="drive-nav__section">个人视图</div>
        {VIEW_ORDER.filter((v) => (v !== 'links' || hasPermission('drive:link:create')) && (v !== 'recycle' || hasPermission('drive:recycle:list'))).map((v) => {
          const Icon = VIEW_ICONS[v];
          const active = view === v && !searching;
          return (
            <button key={v} type="button" className={`drive-nav__item${active ? ' drive-nav__item--active' : ''}`} onClick={() => openView(v)} aria-current={active ? 'page' : undefined}>
              <Icon size={16} className="drive-nav__icon" />
              <span className="drive-nav__label"><span className="drive-nav__name">{DRIVE_VIEW_LABELS[v]}</span></span>
            </button>
          );
        })}
      </MasterDetailLayout.Body>
    </>
  );

  let detail: ReactNode;
  if (searching) {
    detail = <DriveSearchView keyword={searching.keyword} fullText={searching.fullText} onOpenFolder={openSpace} onOpenDetail={setDetailId} onClear={() => setSearching(null)} />;
  } else if (view !== 'space') {
    detail = <DriveViews view={view} onOpenFolder={openSpace} onOpenDetail={setDetailId} />;
  } else if (spaceId && (activeSpace || folderId)) {
    detail = <DriveBrowser spaceId={spaceId} folderId={folderId} onNavigate={navigateFolder} onOpenDetail={setDetailId} onUpload={uploader.enqueue} />;
  } else if (spacesQuery.isPending) {
    detail = <div className="drive-center"><Spin size="large" /></div>;
  } else {
    detail = <Empty title="没有可访问的空间" description="联系管理员为你开通个人空间，或加入一个协作空间" style={{ marginTop: 80 }} />;
  }

  return (
    <div className="page-container page-container--stretch drive-workbench">
      <MasterDetailLayout
        persistKey="drive-workbench"
        defaultSize={260}
        minSize={220}
        maxSize={380}
        bordered
        style={{ flex: 1, minHeight: 0 }}
        showDetail={showDetailOnNarrow}
        onBack={() => setShowDetailOnNarrow(false)}
        master={master}
        detail={<MasterDetailLayout.Body padding={0} scroll="hidden">{detail}</MasterDetailLayout.Body>}
      />
      <DriveNodeDrawer nodeId={detailId} allowExternalShare={allowExternalShare} onClose={() => setDetailId(null)}
        onDownload={(node) => { void fetchManagedFileBlob(nodeDownloadUrl(node)).then((blob) => downloadBlob(blob, node.name)); }} />
      <DriveUploadQueue items={uploader.items} activeCount={uploader.activeCount} conflict={uploader.conflict} onCancel={uploader.cancel} onClear={uploader.clearFinished} />
    </div>
  );
}
