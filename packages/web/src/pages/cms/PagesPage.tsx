/** 页面搭建：区块 JSON 装配（P3 Batch6）——列表 + 区块搭建器 SideSheet */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button, Dropdown, Form, Input, Modal, Select, SideSheet, Tag, Toast, Typography, Empty,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus, ArrowUp, ArrowDown, Trash2, Pencil, ExternalLink, ChevronDown, GripVertical, RefreshCw, LockKeyhole, ShieldCheck } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useIsMobile } from '@/hooks/useMediaQuery';
import {
  useCmsSiteList, useCmsPageList, useSaveCmsPage, useDeleteCmsPage, useCmsChannelTree,
  useCmsFragmentList, cmsPageKeys, useCmsPageDetail, useCmsPageBlockAcls, useSetCmsPageBlockAcls,
} from '@/hooks/queries/cms';
import { useAllRoles } from '@/hooks/queries/roles';
import { useAllUsers } from '@/hooks/queries/users';
import { CMS_PAGE_BLOCK_AUDIENCE_LABELS, CMS_PAGE_BLOCK_TYPES } from '@zenith/shared';
import type { CmsChannel, CmsPage, CmsPageBlock, CmsPageBlockType } from '@zenith/shared';
import { CmsSiteSelect, cmsPreviewUrl } from './CmsSiteSelect';
import { formatDateTimeForApi } from '@/utils/date';

function channelsToSelectTree(nodes: CmsChannel[]): { key: string; value: number; label: string; children?: ReturnType<typeof channelsToSelectTree> }[] {
  return nodes.map((n) => ({
    key: String(n.id),
    value: n.id,
    label: n.name,
    children: n.children ? channelsToSelectTree(n.children) : undefined,
  }));
}

function newBlockId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const BLOCK_TYPE_LABEL = Object.fromEntries(CMS_PAGE_BLOCK_TYPES.map((t) => [t.value, t.label]));

/** 区块摘要（列表卡片展示用） */
function blockSummary(block: CmsPageBlock): string {
  const p = block.props;
  switch (block.type) {
    case 'hero': return String(p.title ?? '');
    case 'richtext': return String(p.html ?? '').replace(/<[^>]+>/g, '').slice(0, 40);
    case 'image': return String(p.src ?? '');
    case 'content-list': return `${String(p.title ?? '')}（${String(p.mode ?? 'latest')} × ${Number(p.count) || 5}）`;
    case 'columns': return `${Array.isArray(p.items) ? p.items.length : 0} 列`;
    case 'fragment': return `code: ${String(p.code ?? '')}`;
    default: return '';
  }
}

export default function PagesPage() {
  const { hasPermission } = usePermission();
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const { page, pageSize, buildPagination, resetPage } = usePagination();

  const listQuery = useCmsPageList({ page, pageSize, siteId, ...(keyword ? { keyword } : {}) });
  const { data: sitesPage } = useCmsSiteList({ page: 1, pageSize: 100 });
  const treeQuery = useCmsChannelTree(siteId);
  const saveMutation = useSaveCmsPage();
  const deleteMutation = useDeleteCmsPage();

  // 搭建器状态
  const [builderVisible, setBuilderVisible] = useState(false);
  const [editingPage, setEditingPage] = useState<CmsPage | null>(null);
  const [blocks, setBlocks] = useState<CmsPageBlock[]>([]);
  const detailQuery = useCmsPageDetail(editingPage?.id);
  const editablePage = detailQuery.data ?? editingPage;
  const baseFormApi = useRef<FormApi | null>(null);
  const { data: fragmentsPage } = useCmsFragmentList({ page: 1, pageSize: 100, siteId: siteId ?? 0 }, !!siteId && builderVisible);
  const fragments = fragmentsPage?.list;
  // 区块编辑
  const [blockModal, setBlockModal] = useState<{ block: CmsPageBlock; index: number } | null>(null);
  const blockFormApi = useRef<FormApi | null>(null);
  // 拖拽排序 + 内嵌预览
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const [aclBlock, setAclBlock] = useState<CmsPageBlock | null>(null);
  const [aclUserIds, setAclUserIds] = useState<number[]>([]);
  const [aclRoleIds, setAclRoleIds] = useState<number[]>([]);
  const aclQuery = useCmsPageBlockAcls(editingPage?.id, !!aclBlock);
  const setAclMutation = useSetCmsPageBlockAcls();
  const usersQuery = useAllUsers({ enabled: !!aclBlock });
  const rolesQuery = useAllRoles({ enabled: !!aclBlock });
  const canEditPage = hasPermission('cms:page:update');

  useEffect(() => {
    if (builderVisible) setBlocks(editablePage?.blocks ?? []);
  }, [builderVisible, editablePage]);

  useEffect(() => {
    if (!aclBlock) return;
    const grants = (aclQuery.data ?? []).filter((grant) => grant.blockId === aclBlock.id);
    setAclUserIds(grants.filter((grant) => grant.subjectType === 'user').map((grant) => grant.subjectId));
    setAclRoleIds(grants.filter((grant) => grant.subjectType === 'role').map((grant) => grant.subjectId));
  }, [aclBlock, aclQuery.data]);

  function handleSearch() {
    setKeyword(keywordDraft.trim());
    resetPage();
    void qc.invalidateQueries({ queryKey: cmsPageKeys.lists });
  }

  function handleReset() {
    setKeywordDraft('');
    setKeyword('');
    resetPage();
    void qc.invalidateQueries({ queryKey: cmsPageKeys.lists });
  }

  function openBuilder(record: CmsPage | null) {
    setEditingPage(record);
    setBuilderVisible(true);
  }

  function addBlock(type: CmsPageBlockType) {
    const defaults: Record<CmsPageBlockType, Record<string, unknown>> = {
      hero: { title: '标题文案', subtitle: '', image: '', buttonText: '', buttonUrl: '' },
      richtext: { html: '<p>在这里输入内容…</p>' },
      image: { src: '', alt: '', linkUrl: '' },
      'content-list': { title: '最新内容', mode: 'latest', count: 5 },
      columns: { items: [{ title: '特性一', description: '' }, { title: '特性二', description: '' }, { title: '特性三', description: '' }] },
      fragment: { code: '' },
    };
    setBlocks((prev) => [...prev, {
      id: newBlockId(),
      type,
      props: defaults[type],
      displayCondition: { audience: 'always' },
      canManage: true,
      aclConfigured: false,
      disabledReason: null,
    }]);
  }

  function moveBlock(index: number, dir: -1 | 1) {
    setBlocks((prev) => {
      if (!prev.every((block) => block.canManage !== false) || prev[index]?.canManage === false) return prev;
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  /** 原生 HTML5 拖拽排序：把 from 位置的区块移动到 to 位置 */
  function reorderBlock(from: number, to: number) {
    if (from === to) return;
    setBlocks((prev) => {
      if (!prev.every((block) => block.canManage !== false)) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function removeBlock(index: number) {
    setBlocks((prev) => prev[index]?.canManage === false ? prev : prev.filter((_, i) => i !== index));
  }

  async function handleBlockModalOk() {
    if (!blockModal) return;
    const values = (await blockFormApi.current?.validate().catch(() => null)) ?? null;
    if (!values) throw new Error('validation');
    const {
      displayAudience,
      displayStartAt,
      displayEndAt,
      ...props
    } = values as Record<string, unknown>;
    const startAt = displayStartAt instanceof Date ? formatDateTimeForApi(displayStartAt) : (displayStartAt || null);
    const endAt = displayEndAt instanceof Date ? formatDateTimeForApi(displayEndAt) : (displayEndAt || null);
    setBlocks((prev) => prev.map((block, index) => (index === blockModal.index ? {
      ...block,
      props,
      displayCondition: {
        audience: (displayAudience as 'always' | 'guest' | 'member') ?? 'always',
        ...(startAt ? { startAt: String(startAt) } : {}),
        ...(endAt ? { endAt: String(endAt) } : {}),
      },
    } : block)));
    setBlockModal(null);
  }

  async function handleSavePage() {
    let base: Record<string, unknown>;
    try {
      base = (await baseFormApi.current?.validate()) ?? {};
    } catch {
      return;
    }
    await saveMutation.mutateAsync({
      id: editingPage?.id,
      values: {
        ...(editingPage ? {} : { siteId }),
        ...(editingPage && !canEditPage ? {} : base),
        blocks: blocks.map(({ id, type, props, displayCondition }) => ({ id, type, props, displayCondition })),
      },
    });
    Toast.success(editingPage ? '保存成功（静态页已刷新）' : '创建成功');
    if (editingPage) {
      setPreviewEpoch((e) => e + 1); // 刷新内嵌预览
    } else {
      setBuilderVisible(false);
    }
  }

  const currentSite = (sitesPage?.list ?? []).find((s) => s.id === siteId);

  const columns: ColumnProps<CmsPage>[] = [
    {
      title: '页面名称',
      dataIndex: 'name',
      width: 180,
      render: (v: string, record) => (
        <span>
          {record.isHome ? <Tag size="small" color="green" style={{ marginRight: 4 }}>首页</Tag> : null}
          {v}
        </span>
      ),
    },
    { title: '路径', dataIndex: 'slug', width: 140, render: (v: string) => <Typography.Text code>/p/{v}/</Typography.Text> },
    { title: '区块数', width: 80, render: (_: unknown, r) => r.blocks.length },
    {
      title: '渲染策略',
      width: 110,
      render: (_: unknown, record) => record.requiresDynamic
        ? <Tag size="small" color="orange">动态受众</Tag>
        : <Tag size="small">可静态化</Tag>,
    },
    {
      title: '区块构成',
      width: 240,
      render: (_: unknown, r) => (
        <span>
          {[...new Set(r.blocks.map((b) => b.type))].map((t) => (
            <Tag size="small" key={t} style={{ marginRight: 4 }}>{BLOCK_TYPE_LABEL[t] ?? t}</Tag>
          ))}
        </span>
      ),
    },
    { title: '更新时间', dataIndex: 'updatedAt', width: 180 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right' as const,
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag size="small">停用</Tag>),
    },
    createOperationColumn<CmsPage>({
      width: 200,
      desktopInlineKeys: ['builder', 'preview'],
      actions: (record) => [
        ...(canEditPage || record.blocks.some((block) => block.canManage) ? [{
          key: 'builder',
          label: '搭建',
          onClick: () => openBuilder(record),
        }] : []),
        ...(currentSite ? [{
          key: 'preview',
          label: '预览',
          onClick: () => {
            window.open(cmsPreviewUrl(currentSite.code, record.isHome ? '/' : `/p/${record.slug}/`), '_blank');
          },
        }] : []),
        ...(hasPermission('cms:page:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: `删除页面「${record.name}」？`,
              content: '静态文件将同步移除',
              onOk: async () => {
                await deleteMutation.mutateAsync(record.id);
                Toast.success('删除成功');
              },
            });
          },
        }] : []),
      ],
    }),
  ];

  const editingBlockType = blockModal?.block.type;
  const allBlocksManageable = blocks.every((block) => block.canManage !== false);

  return (
    <div className="page-container">
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); resetPage(); }} />
        <Input prefix={<Search size={14} />} placeholder="页面名称 / slug" value={keywordDraft} onChange={setKeywordDraft} showClear style={{ width: 200 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('cms:page:create') ? (
          <Button type="primary" icon={<Plus size={14} />} onClick={() => openBuilder(null)}>新增</Button>
        ) : null}
      </SearchToolbar>

      <ConfigurableTable<CmsPage>
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        rowKey="id"
        loading={listQuery.isFetching}
        scroll={{ x: 1100 }}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
      />

      {/* 搭建器 */}
      <SideSheet
        title={editingPage ? `搭建：${editingPage.name}` : '新增页面'}
        visible={builderVisible}
        onCancel={() => setBuilderVisible(false)}
        width={isMobile ? '100%' : 680}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button onClick={() => setBuilderVisible(false)}>取消</Button>
            <Button theme="solid" loading={saveMutation.isPending} onClick={() => void handleSavePage()}>保存</Button>
          </div>
        )}
      >
        <Form
          key={editablePage?.id ?? 'new'}
          getFormApi={(api) => { baseFormApi.current = api; }}
          allowEmpty
          labelPosition="left"
          labelWidth={90}
          initValues={editablePage ? {
            name: editablePage.name,
            slug: editablePage.slug,
            isHome: editablePage.isHome,
            status: editablePage.status,
            seoTitle: editablePage.seoTitle ?? '',
            seoKeywords: editablePage.seoKeywords ?? '',
            seoDescription: editablePage.seoDescription ?? '',
          } : { isHome: false, status: 'enabled' }}
        >
          <Form.Input field="name" label="页面名称" disabled={!canEditPage} rules={[{ required: true, message: '请输入页面名称' }]} />
          <Form.Input field="slug" label="路径 slug" placeholder="小写字母/数字/中划线，访问 /p/{slug}/"
            disabled={!canEditPage}
            rules={[{ required: true, message: '请输入 slug' }, { pattern: /^[a-z0-9-]+$/, message: '仅小写字母/数字/中划线' }]} />
          <Form.Switch field="isHome" label="接管首页" disabled={!canEditPage} extraText="启用后站点首页渲染此页面（每站点一个）" />
          <Form.RadioGroup field="status" label="状态" disabled={!canEditPage}>
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
          <Form.Input field="seoTitle" label="SEO 标题" disabled={!canEditPage} />
          <Form.Input field="seoKeywords" label="SEO 关键词" disabled={!canEditPage} />
          <Form.TextArea field="seoDescription" label="SEO 描述" rows={2} disabled={!canEditPage} />
        </Form>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 10px' }}>
          <Typography.Title heading={6} style={{ margin: 0 }}>区块（{blocks.length}）</Typography.Title>
          {canEditPage ? <Dropdown
            trigger="click"
            render={(
              <Dropdown.Menu>
                {CMS_PAGE_BLOCK_TYPES.map((t) => (
                  <Dropdown.Item key={t.value} onClick={() => addBlock(t.value)}>{t.label}</Dropdown.Item>
                ))}
              </Dropdown.Menu>
            )}
          >
            <Button icon={<ChevronDown size={14} />} iconPosition="right" size="small">添加区块</Button>
          </Dropdown> : null}
        </div>

        {blocks.length === 0 ? (
          <Empty title="尚无区块" description="点击「添加区块」开始搭建页面" style={{ padding: 24 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {blocks.map((block, index) => (
              <div
                key={block.id}
                draggable={allBlocksManageable && block.canManage !== false}
                onDragStart={(e) => {
                  dragIndexRef.current = index;
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverIndex !== index) setDragOverIndex(index);
                }}
                onDragLeave={() => setDragOverIndex((cur) => (cur === index ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndexRef.current !== null) reorderBlock(dragIndexRef.current, index);
                  dragIndexRef.current = null;
                  setDragOverIndex(null);
                }}
                onDragEnd={() => {
                  dragIndexRef.current = null;
                  setDragOverIndex(null);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  border: dragOverIndex === index ? '1px dashed var(--semi-color-primary)' : '1px solid var(--semi-color-border)',
                  borderRadius: 'var(--semi-border-radius-medium)',
                  padding: '10px 14px',
                  cursor: allBlocksManageable && block.canManage !== false ? 'grab' : 'default',
                  background: dragOverIndex === index ? 'var(--semi-color-primary-light-default)' : undefined,
                }}
              >
                <GripVertical size={14} color="var(--semi-color-text-3)" />
                <Tag size="small">{BLOCK_TYPE_LABEL[block.type] ?? block.type}</Tag>
                {block.canManage === false ? (
                  <span title={block.disabledReason ?? '当前区块只读'}>
                    <Tag size="small" color="orange">
                      <LockKeyhole size={12} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />只读
                    </Tag>
                  </span>
                ) : null}
                {block.displayCondition?.audience && block.displayCondition.audience !== 'always' ? (
                  <Tag size="small" color="blue">
                    {CMS_PAGE_BLOCK_AUDIENCE_LABELS[block.displayCondition.audience]}
                  </Tag>
                ) : null}
                <Typography.Text ellipsis={{ showTooltip: true }} style={{ flex: 1, fontSize: 13, color: 'var(--semi-color-text-2)' }}>
                  {blockSummary(block) || '（未配置）'}
                </Typography.Text>
                <Button aria-label="上移区块" title={!allBlocksManageable ? '页面含只读区块，禁止重排' : undefined}
                  size="small" theme="borderless" icon={<ArrowUp size={13} />}
                  disabled={!allBlocksManageable || block.canManage === false || index === 0} onClick={() => moveBlock(index, -1)} />
                <Button aria-label="下移区块" title={!allBlocksManageable ? '页面含只读区块，禁止重排' : undefined}
                  size="small" theme="borderless" icon={<ArrowDown size={13} />}
                  disabled={!allBlocksManageable || block.canManage === false || index === blocks.length - 1} onClick={() => moveBlock(index, 1)} />
                <Button aria-label="编辑区块" title={block.disabledReason ?? undefined}
                  size="small" theme="borderless" icon={<Pencil size={13} />}
                  disabled={block.canManage === false} onClick={() => setBlockModal({ block, index })} />
                {hasPermission('cms:page:acl') && editingPage ? (
                  <Button aria-label="设置区块权限" size="small" theme="borderless" icon={<ShieldCheck size={13} />}
                    onClick={() => setAclBlock(block)} />
                ) : null}
                <Button aria-label="删除区块" title={block.disabledReason ?? undefined}
                  size="small" theme="borderless" type="danger" icon={<Trash2 size={13} />}
                  disabled={block.canManage === false} onClick={() => removeBlock(index)} />
              </div>
            ))}
          </div>
        )}

        {editingPage && currentSite ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 8px' }}>
              <Typography.Title heading={6} style={{ margin: 0 }}>实时预览（保存后自动刷新）</Typography.Title>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="small" theme="borderless" icon={<RefreshCw size={13} />} onClick={() => setPreviewEpoch((e) => e + 1)}>刷新</Button>
                <Button
                  size="small"
                  theme="borderless"
                  icon={<ExternalLink size={13} />}
                  onClick={() => window.open(cmsPreviewUrl(currentSite.code, editingPage.isHome ? '/' : `/p/${editingPage.slug}/`), '_blank')}
                >
                  新窗口打开
                </Button>
              </div>
            </div>
            <iframe
              key={previewEpoch}
              title="页面预览"
              src={`${cmsPreviewUrl(currentSite.code, editingPage.isHome ? '/' : `/p/${editingPage.slug}/`)}?_t=${previewEpoch}`}
              style={{ width: '100%', height: 380, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', background: '#fff' }}
            />
          </>
        ) : null}
      </SideSheet>

      {/* 区块属性编辑 */}
      <AppModal
        title={blockModal ? `编辑区块：${BLOCK_TYPE_LABEL[blockModal.block.type]}` : '编辑区块'}
        visible={!!blockModal}
        onOk={handleBlockModalOk}
        onCancel={() => setBlockModal(null)}
        width={560}
        closeOnEsc
      >
        {blockModal ? (
          <Form
            key={blockModal.block.id}
            getFormApi={(api) => { blockFormApi.current = api; }}
            allowEmpty
            labelPosition="left"
            labelWidth={100}
            initValues={{
              ...blockModal.block.props,
              displayAudience: blockModal.block.displayCondition?.audience ?? 'always',
              displayStartAt: blockModal.block.displayCondition?.startAt ?? undefined,
              displayEndAt: blockModal.block.displayCondition?.endAt ?? undefined,
            }}
          >
            <Form.Select
              field="displayAudience"
              label="展示受众"
              style={{ width: '100%' }}
              optionList={Object.entries(CMS_PAGE_BLOCK_AUDIENCE_LABELS).map(([value, label]) => ({ value, label }))}
              extraText="游客/会员条件会自动强制页面动态渲染，敏感内容不可放入公开区块"
            />
            <Form.DatePicker
              field="displayStartAt"
              label="展示开始"
              type="dateTime"
              style={{ width: '100%' }}
              placeholder="不限制"
            />
            <Form.DatePicker
              field="displayEndAt"
              label="展示结束"
              type="dateTime"
              style={{ width: '100%' }}
              placeholder="不限制"
            />
            {editingBlockType === 'hero' ? (
              <>
                <Form.Input field="title" label="主标题" rules={[{ required: true, message: '请输入主标题' }]} />
                <Form.Input field="subtitle" label="副标题" />
                <Form.Input field="image" label="背景图 URL" />
                <Form.Input field="buttonText" label="按钮文字" />
                <Form.Input field="buttonUrl" label="按钮链接" />
              </>
            ) : null}
            {editingBlockType === 'richtext' ? (
              <Form.TextArea field="html" label="HTML 内容" rows={10} placeholder="支持 HTML 标签" />
            ) : null}
            {editingBlockType === 'image' ? (
              <>
                <Form.Input field="src" label="图片 URL" rules={[{ required: true, message: '请输入图片 URL' }]} />
                <Form.Input field="alt" label="替代文本" />
                <Form.Input field="linkUrl" label="点击链接" />
              </>
            ) : null}
            {editingBlockType === 'content-list' ? (
              <>
                <Form.Input field="title" label="标题" />
                <Form.TreeSelect field="channelId" label="栏目" style={{ width: '100%' }} showClear
                  treeData={channelsToSelectTree(treeQuery.data ?? [])} placeholder="留空取全站" />
                <Form.Select field="mode" label="取数模式" style={{ width: '100%' }}
                  optionList={[
                    { value: 'latest', label: '最新发布' },
                    { value: 'recommend', label: '推荐' },
                    { value: 'hot', label: '热门' },
                  ]} />
                <Form.InputNumber field="count" label="条数" min={1} max={20} style={{ width: '100%' }} />
              </>
            ) : null}
            {editingBlockType === 'columns' ? (
              <Form.Slot label="列卡片">
                <ColumnsEditor formApi={blockFormApi} initItems={(blockModal.block.props.items as { title?: string; description?: string }[]) ?? []} />
              </Form.Slot>
            ) : null}
            {editingBlockType === 'fragment' ? (
              <Form.Select field="code" label="碎片" style={{ width: '100%' }}
                optionList={(fragments ?? []).map((f) => ({ value: f.code, label: `${f.name}（${f.code}）` }))}
                rules={[{ required: true, message: '请选择碎片' }]} />
            ) : null}
          </Form>
        ) : null}
      </AppModal>

      <SideSheet
        title={aclBlock ? `区块权限：${BLOCK_TYPE_LABEL[aclBlock.type]}` : '区块权限'}
        visible={!!aclBlock}
        onCancel={() => setAclBlock(null)}
        width={480}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setAclBlock(null)}>取消</Button>
            <Button
              type="primary"
              loading={setAclMutation.isPending}
              onClick={async () => {
                if (!editingPage || !aclBlock) return;
                await setAclMutation.mutateAsync({
                  pageId: editingPage.id,
                  blockIds: [aclBlock.id],
                  grants: [
                    ...aclUserIds.map((subjectId) => ({ subjectType: 'user' as const, subjectId })),
                    ...aclRoleIds.map((subjectId) => ({ subjectType: 'role' as const, subjectId })),
                  ],
                });
                Toast.success(aclUserIds.length + aclRoleIds.length > 0 ? '区块权限已更新' : '已恢复继承页面编辑权限');
                setAclBlock(null);
              }}
            >
              保存
            </Button>
          </div>
        )}
      >
        <Typography.Paragraph type="tertiary">
          未配置授权时继承页面编辑权限；配置任一授权后采用 fail-closed，仅获授权用户/角色及平台超管可管理。
        </Typography.Paragraph>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 18 }}>
          <label>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>授权用户</div>
            <Select
              multiple
              value={aclUserIds}
              loading={usersQuery.isFetching || aclQuery.isFetching}
              style={{ width: '100%' }}
              placeholder="选择平台用户"
              optionList={(usersQuery.data ?? []).map((user) => ({
                value: user.id,
                label: user.nickname || user.username,
              }))}
              onChange={(value) => setAclUserIds(value as number[])}
            />
          </label>
          <label>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>授权角色</div>
            <Select
              multiple
              value={aclRoleIds}
              loading={rolesQuery.isFetching || aclQuery.isFetching}
              style={{ width: '100%' }}
              placeholder="选择平台角色"
              optionList={(rolesQuery.data ?? []).map((role) => ({ value: role.id, label: role.name }))}
              onChange={(value) => setAclRoleIds(value as number[])}
            />
          </label>
        </div>
      </SideSheet>
    </div>
  );
}

/** 多列卡片编辑（简单受控列表，保存时写回 form.items） */
function ColumnsEditor({ formApi, initItems }: Readonly<{ formApi: React.RefObject<FormApi | null>; initItems: { title?: string; description?: string }[] }>) {
  const [items, setItems] = useState(initItems.length > 0 ? initItems : [{ title: '', description: '' }]);

  useEffect(() => {
    formApi.current?.setValue('items', items);
  }, [items, formApi]);

  function update(index: number, key: 'title' | 'description', value: string) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, [key]: value } : it)));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, index) => (
        <div key={`col-${index}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Input placeholder="标题" value={item.title ?? ''} onChange={(v) => update(index, 'title', v)} style={{ width: 150 }} />
          <Input placeholder="描述" value={item.description ?? ''} onChange={(v) => update(index, 'description', v)} style={{ flex: 1 }} />
          <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={13} />}
            disabled={items.length <= 1}
            onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))} />
        </div>
      ))}
      <Button size="small" icon={<Plus size={13} />} onClick={() => setItems((prev) => [...prev, { title: '', description: '' }])}>
        添加一列
      </Button>
    </div>
  );
}
