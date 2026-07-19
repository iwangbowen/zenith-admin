/** 页面搭建：区块 JSON 装配（P3 Batch6）——列表 + 区块搭建器 SideSheet */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button, Dropdown, Form, Input, Modal, SideSheet, Tag, Toast, Typography, Empty,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus, ArrowUp, ArrowDown, Trash2, Pencil, ExternalLink, ChevronDown } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useIsMobile } from '@/hooks/useMediaQuery';
import {
  useCmsSiteList, useCmsPageList, useSaveCmsPage, useDeleteCmsPage, useCmsChannelTree,
  useCmsFragmentList, cmsPageKeys,
} from '@/hooks/queries/cms';
import { CMS_PAGE_BLOCK_TYPES } from '@zenith/shared';
import type { CmsChannel, CmsPage, CmsPageBlock, CmsPageBlockType } from '@zenith/shared';
import { CmsSiteSelect, cmsPreviewUrl } from './CmsSiteSelect';

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
  const baseFormApi = useRef<FormApi | null>(null);
  const { data: fragmentsPage } = useCmsFragmentList({ page: 1, pageSize: 100, siteId: siteId ?? 0 }, !!siteId && builderVisible);
  const fragments = fragmentsPage?.list;
  // 区块编辑
  const [blockModal, setBlockModal] = useState<{ block: CmsPageBlock; index: number } | null>(null);
  const blockFormApi = useRef<FormApi | null>(null);

  useEffect(() => {
    if (builderVisible) setBlocks(editingPage?.blocks ?? []);
  }, [builderVisible, editingPage]);

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
    setBlocks((prev) => [...prev, { id: newBlockId(), type, props: defaults[type] }]);
  }

  function moveBlock(index: number, dir: -1 | 1) {
    setBlocks((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeBlock(index: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleBlockModalOk() {
    if (!blockModal) return;
    const values = (await blockFormApi.current?.validate().catch(() => null)) ?? null;
    if (!values) throw new Error('validation');
    setBlocks((prev) => prev.map((b, i) => (i === blockModal.index ? { ...b, props: values as Record<string, unknown> } : b)));
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
      values: { ...(editingPage ? {} : { siteId }), ...base, blocks },
    });
    Toast.success(editingPage ? '保存成功（静态页已刷新）' : '创建成功');
    setBuilderVisible(false);
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
    { title: '更新时间', dataIndex: 'updatedAt', width: 170 },
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
        ...(hasPermission('cms:page:update') ? [{
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
        scroll={{ x: 1090 }}
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
          key={editingPage?.id ?? 'new'}
          getFormApi={(api) => { baseFormApi.current = api; }}
          allowEmpty
          labelPosition="left"
          labelWidth={90}
          initValues={editingPage ? {
            name: editingPage.name,
            slug: editingPage.slug,
            isHome: editingPage.isHome,
            status: editingPage.status,
            seoTitle: editingPage.seoTitle ?? '',
            seoKeywords: editingPage.seoKeywords ?? '',
            seoDescription: editingPage.seoDescription ?? '',
          } : { isHome: false, status: 'enabled' }}
        >
          <Form.Input field="name" label="页面名称" rules={[{ required: true, message: '请输入页面名称' }]} />
          <Form.Input field="slug" label="路径 slug" placeholder="小写字母/数字/中划线，访问 /p/{slug}/"
            rules={[{ required: true, message: '请输入 slug' }, { pattern: /^[a-z0-9-]+$/, message: '仅小写字母/数字/中划线' }]} />
          <Form.Switch field="isHome" label="接管首页" extraText="启用后站点首页渲染此页面（每站点一个）" />
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
          <Form.Input field="seoTitle" label="SEO 标题" />
          <Form.Input field="seoKeywords" label="SEO 关键词" />
          <Form.TextArea field="seoDescription" label="SEO 描述" rows={2} />
        </Form>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 10px' }}>
          <Typography.Title heading={6} style={{ margin: 0 }}>区块（{blocks.length}）</Typography.Title>
          <Dropdown
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
          </Dropdown>
        </div>

        {blocks.length === 0 ? (
          <Empty title="尚无区块" description="点击「添加区块」开始搭建页面" style={{ padding: 24 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {blocks.map((block, index) => (
              <div
                key={block.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  border: '1px solid var(--semi-color-border)',
                  borderRadius: 'var(--semi-border-radius-medium)',
                  padding: '10px 14px',
                }}
              >
                <Tag size="small">{BLOCK_TYPE_LABEL[block.type] ?? block.type}</Tag>
                <Typography.Text ellipsis={{ showTooltip: true }} style={{ flex: 1, fontSize: 13, color: 'var(--semi-color-text-2)' }}>
                  {blockSummary(block) || '（未配置）'}
                </Typography.Text>
                <Button size="small" theme="borderless" icon={<ArrowUp size={13} />} disabled={index === 0} onClick={() => moveBlock(index, -1)} />
                <Button size="small" theme="borderless" icon={<ArrowDown size={13} />} disabled={index === blocks.length - 1} onClick={() => moveBlock(index, 1)} />
                <Button size="small" theme="borderless" icon={<Pencil size={13} />} onClick={() => setBlockModal({ block, index })} />
                <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={13} />} onClick={() => removeBlock(index)} />
              </div>
            ))}
          </div>
        )}

        {editingPage && currentSite ? (
          <Button
            style={{ marginTop: 14 }}
            icon={<ExternalLink size={13} />}
            size="small"
            onClick={() => window.open(cmsPreviewUrl(currentSite.code, editingPage.isHome ? '/' : `/p/${editingPage.slug}/`), '_blank')}
          >
            预览页面
          </Button>
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
            initValues={blockModal.block.props}
          >
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
