import { useMemo, useState } from 'react';
import { Button, Dropdown, Input, Modal, Tag, Tree, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree/interface';
import { ChevronDown, Home, Link2, Search } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { buildCmsEntityLink, buildCmsChannelCodeLink, parseCmsLink, CMS_CONTENT_STATUS_LABELS } from '@zenith/shared/cms';
import type { CmsChannel, CmsContent } from '@zenith/shared/cms';
import { useQueryClient } from '@tanstack/react-query';
import { cmsContentKeys, useAllCmsSites, useCmsChannelTree, useCmsContentList, useCmsLinkTarget } from '@/hooks/queries/cms';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { usePagination } from '@/hooks/usePagination';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { dateTimeColumn } from '@/utils/table-columns';
import { channelsToTree } from './channel-tree';

type PickerMode = 'content' | 'channel' | null;

/** 内容选择弹窗：左侧栏目树定位，右侧按关键词检索本站内容 */
function ContentPickerModal({ siteId, visible, onCancel, onSelect, excludeId }: Readonly<{
  siteId: number | undefined;
  visible: boolean;
  onCancel: () => void;
  onSelect: (content: CmsContent) => void;
  excludeId?: number;
}>) {
  const queryClient = useQueryClient();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [keyword, setKeyword] = useState('');
  const [channelId, setChannelId] = useState<number | undefined>(undefined);
  // 选择器弹窗固定 10 条 / 页；usePagination 提供总数收缩后的页码钳制
  const { page, pageSize, setPage, buildPagination } = usePagination(10);
  const isMobile = useIsMobile();
  const enabled = visible && siteId !== undefined;
  const listQuery = useCmsContentList(
    { page, pageSize, siteId: siteId ?? 0, channelId, keyword: keyword || undefined, status: 'published' },
    enabled,
  );
  const rows = (listQuery.data?.list ?? []).filter((c) => c.id !== excludeId);

  const treeQuery = useCmsChannelTree(enabled ? siteId : undefined);
  const sitesQuery = useAllCmsSites();
  const siteName = sitesQuery.data?.find((s) => s.id === siteId)?.name ?? '全部栏目';
  const treeData: TreeNodeData[] = useMemo(() => [{
    key: 'all',
    label: siteName,
    icon: <Home size={14} style={{ marginRight: 4 }} />,
    children: channelsToTree(treeQuery.data ?? []),
  }], [siteName, treeQuery.data]);

  const handleSearch = () => {
    setKeyword(draftKeyword);
    setPage(1);
    // 关键词未变时 query key 不变，不显式失效就不会真正回源刷新
    void queryClient.invalidateQueries({ queryKey: cmsContentKeys.lists });
  };
  const handleReset = () => {
    setDraftKeyword('');
    setKeyword('');
    setChannelId(undefined);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: cmsContentKeys.lists });
  };

  const columns: ColumnProps<CmsContent>[] = [
    { title: '标题', dataIndex: 'title', ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: CmsContent['status']) => CMS_CONTENT_STATUS_LABELS[v],
    },
    dateTimeColumn('发布时间', 'publishedAt'),
    {
      title: '操作', width: 68, fixed: 'right',
      render: (_: unknown, record: CmsContent) => (
        <Button theme="borderless" size="small" onClick={() => onSelect(record)}>选择</Button>
      ),
    },
  ];

  return (
    <Modal title="选择内容" visible={visible} onCancel={onCancel} footer={null} width={900} closeOnEsc>
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: isMobile ? 12 : 16,
        height: isMobile ? 'auto' : 480,
      }}>
        <div
          style={{
            width: isMobile ? '100%' : 220,
            flexShrink: 0,
            maxHeight: isMobile ? 180 : undefined,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            paddingRight: isMobile ? 0 : 12,
            paddingBottom: isMobile ? 12 : 0,
            borderRight: isMobile ? undefined : '1px solid var(--semi-color-border)',
            borderBottom: isMobile ? '1px solid var(--semi-color-border)' : undefined,
          }}
        >
          <Tree
            treeData={treeData}
            value={channelId ? String(channelId) : 'all'}
            filterTreeNode
            showFilteredOnly
            searchPlaceholder="输入栏目名称"
            defaultExpandAll
            onSelect={(key) => { setChannelId(key === 'all' ? undefined : Number(key)); setPage(1); }}
            style={{ flex: 1, width: '100%', overflow: 'auto' }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <Input
              prefix={<Search size={14} />}
              placeholder="输入内容标题"
              value={draftKeyword}
              onChange={setDraftKeyword}
              onEnterPress={handleSearch}
              showClear
              style={{ flex: 1, minWidth: 160 }}
            />
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
          </div>
          <ConfigurableTable
            size="small"
            rowKey="id"
            columnSettingsKey="cms-link-content-picker"
            columns={columns}
            dataSource={rows}
            loading={listQuery.isFetching}
            onRefresh={() => void listQuery.refetch()}
            refreshLoading={listQuery.isFetching}
            scroll={{ y: isMobile ? 240 : 336 }}
            pagination={{ ...buildPagination(listQuery.data?.total ?? 0), showSizeChanger: false }}
          />
        </div>
      </div>
    </Modal>
  );
}

/** 栏目选择弹窗 */
function ChannelPickerModal({ siteId, visible, onCancel, onSelect, excludeId }: Readonly<{
  siteId: number | undefined;
  visible: boolean;
  onCancel: () => void;
  onSelect: (channel: CmsChannel) => void;
  excludeId?: number;
}>) {
  const treeQuery = useCmsChannelTree(siteId);
  const treeData = useMemo(() => channelsToTree(treeQuery.data ?? []), [treeQuery.data]);
  const channelById = useMemo(() => {
    const map = new Map<number, CmsChannel>();
    const walk = (nodes: CmsChannel[]) => {
      for (const n of nodes) {
        map.set(n.id, n);
        if (n.children) walk(n.children);
      }
    };
    walk(treeQuery.data ?? []);
    return map;
  }, [treeQuery.data]);

  return (
    <Modal title="选择栏目" visible={visible} onCancel={onCancel} footer={null} width={480} closeOnEsc>
      <Tree
        treeData={treeData}
        filterTreeNode
        searchPlaceholder="搜索栏目"
        style={{ maxHeight: 420, overflow: 'auto' }}
        onSelect={(key) => {
          const id = Number(key);
          const channel = channelById.get(id);
          if (channel && id !== excludeId) onSelect(channel);
        }}
      />
    </Modal>
  );
}

/**
 * 链接字段的「内部链接」选择能力。
 *
 * 刻意做成 hook 而非独立受控组件：链接字段本身仍由 `Form.Input` 承载，
 * 校验、脏值追踪、表单重置全部交给 Semi Form，这里只补三块 UI ——
 * 输入框右侧的选择器、下方的目标回显、以及两个选择弹窗。
 *
 * 存储值遵循 `packages/shared/src/cms-link.ts` 的协议：
 * `entity:channel@news`（栏目，优先）/ `entity:content/123` / `internal:/path` / `https://…`
 */
export function useCmsLinkPicker({
  siteId, value, onPick, disabled, excludeContentId, excludeChannelId,
}: Readonly<{
  siteId: number | undefined;
  /** 当前链接值，用于回显解析结果 */
  value: string | null | undefined;
  onPick: (next: string) => void;
  disabled?: boolean;
  /** 编辑自身时排除，避免选到自己形成跳转死循环 */
  excludeContentId?: number;
  excludeChannelId?: number;
}>) {
  const [picker, setPicker] = useState<PickerMode>(null);
  const raw = value?.trim() ?? '';
  const ref = parseCmsLink(raw);
  const targetQuery = useCmsLinkTarget(siteId, raw);

  const hintText = ((): { text: string; danger: boolean } | null => {
    if (!raw) return null;
    if (!ref) return { text: '链接格式不合法', danger: true };
    if (ref.kind === 'internal') return { text: `站内路径：${ref.path}`, danger: false };
    if (ref.kind !== 'entity') return null;
    if (targetQuery.isFetching) return { text: '解析中…', danger: false };
    const target = targetQuery.data;
    if (!target) return { text: '目标解析失败', danger: true };
    const typeLabel = target.kind === 'entity-channel' ? '栏目' : '内容';
    return target.exists
      ? { text: `站内${typeLabel}：${target.label}`, danger: false }
      : { text: `${target.label}，链接已失效`, danger: true };
  })();

  const suffix = (
    <Dropdown
      trigger="click"
      position="bottomRight"
      clickToHide
      render={(
        <Dropdown.Menu>
          <Dropdown.Item onClick={() => setPicker('content')}>选择内容</Dropdown.Item>
          <Dropdown.Item onClick={() => setPicker('channel')}>选择栏目</Dropdown.Item>
        </Dropdown.Menu>
      )}
    >
      <Button size="small" theme="borderless" disabled={disabled || siteId === undefined} icon={<Link2 size={14} />}>
        内部链接<ChevronDown size={12} style={{ marginLeft: 2 }} />
      </Button>
    </Dropdown>
  );

  const hint = hintText ? (
    <div style={{ marginTop: -8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
      {ref?.kind === 'entity' ? <Tag size="small" color="blue">内部链接</Tag> : null}
      <Typography.Text type={hintText.danger ? 'danger' : 'tertiary'} size="small">{hintText.text}</Typography.Text>
    </div>
  ) : null;

  const modals = (
    <>
      <ContentPickerModal
        siteId={siteId}
        visible={picker === 'content'}
        excludeId={excludeContentId}
        onCancel={() => setPicker(null)}
        onSelect={(content) => { onPick(buildCmsEntityLink('content', content.id)); setPicker(null); }}
      />
      <ChannelPickerModal
        siteId={siteId}
        visible={picker === 'channel'}
        excludeId={excludeChannelId}
        onCancel={() => setPicker(null)}
        onSelect={(channel) => { onPick(buildCmsChannelCodeLink(channel.code)); setPicker(null); }}
      />
    </>
  );

  return { suffix, hint, modals };
}
