import { useRef, useState } from 'react';
import { Button, Form, Tag, Toast, Modal, Row, Col, Select, SideSheet, Tabs, TabPane } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree/interface';
import { Plus, ExternalLink, Merge, ListPlus, Eye } from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import RichTextEditor from '@/components/RichTextEditor';
import { usePermission } from '@/hooks/usePermission';
import {
  useCmsChannelTree, useAllCmsModels, useAllCmsSites, useSaveCmsChannel, useDeleteCmsChannel,
  useCmsThemeTemplates, useCmsPublishChannels, useMergeCmsChannels, useClearCmsChannel, useBatchCreateCmsChannels,
  useCmsChannelUsers, useSetCmsChannelUsers,
} from '@/hooks/queries/cms';
import { useAllUsers } from '@/hooks/queries/users';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';
import { CMS_CHANNEL_TYPE_LABELS, CMS_DEFAULT_CHANNEL_CODE } from '@zenith/shared';
import type { CmsChannel, CmsContent, CmsSiteTemplateDefaults, PaginatedResponse } from '@zenith/shared';
import { CmsSiteSelect, cmsPreviewUrl } from './CmsSiteSelect';

interface ChannelTemplateConfig {
  list: string | null;
  detail: string | null;
  detailByModel: Record<string, string | null>;
}

/** 栏目级按发布通道模板覆盖编辑态（存 settings.templates[通道code]，动态字段名不走 Form） */
type ChannelTemplatesState = Record<string, ChannelTemplateConfig>;

const EMPTY_TPL_CONFIG: ChannelTemplateConfig = { list: null, detail: null, detailByModel: {} };

function channelTemplatesFromSettings(settings: Record<string, unknown> | null | undefined): ChannelTemplatesState {
  const state: ChannelTemplatesState = {};
  const all = settings?.templates as Record<string, CmsSiteTemplateDefaults | undefined> | undefined;
  for (const [code, cfg] of Object.entries(all ?? {})) {
    if (!cfg) continue;
    state[code] = { list: cfg.list ?? null, detail: cfg.detail ?? null, detailByModel: { ...(cfg.detailByModel ?? {}) } };
  }
  return state;
}

function channelTemplatesToSettings(state: ChannelTemplatesState): Record<string, CmsSiteTemplateDefaults> {
  const out: Record<string, CmsSiteTemplateDefaults> = {};
  for (const [code, cfg] of Object.entries(state)) {
    const detailByModel = Object.fromEntries(Object.entries(cfg.detailByModel).filter(([, v]) => v));
    const entry: CmsSiteTemplateDefaults = {
      ...(cfg.list ? { list: cfg.list } : {}),
      ...(cfg.detail ? { detail: cfg.detail } : {}),
      ...(Object.keys(detailByModel).length > 0 ? { detailByModel } : {}),
    };
    if (Object.keys(entry).length > 0) out[code] = entry;
  }
  return out;
}

function toTreeSelectData(nodes: CmsChannel[], excludeId?: number): TreeNodeData[] {
  return nodes
    .filter((n) => n.id !== excludeId)
    .map((n) => ({
      key: String(n.id),
      value: n.id,
      label: n.name,
      children: n.children ? toTreeSelectData(n.children, excludeId) : undefined,
    }));
}

/** 汉字名称 → 拼音 slug（与服务端 slugifyChannelName 规则一致） */
function slugifyName(name: string): string {
  const py = pinyin(name, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('-');
  return py.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

export default function ChannelsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [siteId, setSiteId] = useState<number | undefined>(undefined);

  const treeQuery = useCmsChannelTree(siteId);
  const tree = treeQuery.data ?? [];
  const { data: models } = useAllCmsModels();
  const { data: sites } = useAllCmsSites();
  const currentSite = sites?.find((s) => s.id === siteId);
  const { data: themeTemplates } = useCmsThemeTemplates(currentSite?.theme);
  const { data: publishChannels } = useCmsPublishChannels(siteId);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsChannel | null>(null);
  const [channelType, setChannelType] = useState<string>('list');
  const [pageContent, setPageContent] = useState('');
  const [channelTemplates, setChannelTemplates] = useState<ChannelTemplatesState>({});
  const saveMutation = useSaveCmsChannel();
  const deleteMutation = useDeleteCmsChannel();
  const mergeMutation = useMergeCmsChannels();
  const clearMutation = useClearCmsChannel();
  const batchCreateMutation = useBatchCreateCmsChannels();
  const [mergeModalVisible, setMergeModalVisible] = useState(false);
  const [batchModalVisible, setBatchModalVisible] = useState(false);

  // ─── 栏目授权用户（P5 栏目级数据权限）──────────────────────────────────────
  const [usersModalChannel, setUsersModalChannel] = useState<CmsChannel | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const channelUsersQuery = useCmsChannelUsers(usersModalChannel?.id, !!usersModalChannel);
  const setChannelUsersMutation = useSetCmsChannelUsers();
  const { data: allUsers } = useAllUsers({ enabled: !!usersModalChannel });
  const usersInitialized = useRef(false);
  if (usersModalChannel && channelUsersQuery.data?.userIds && !usersInitialized.current) {
    usersInitialized.current = true;
    setSelectedUserIds(channelUsersQuery.data.userIds);
  }

  function openUsersModal(record: CmsChannel) {
    usersInitialized.current = false;
    setSelectedUserIds([]);
    setUsersModalChannel(record);
  }

  async function handleUsersModalOk() {
    if (!usersModalChannel) return;
    await setChannelUsersMutation.mutateAsync({ channelId: usersModalChannel.id, userIds: selectedUserIds });
    Toast.success('保存成功');
    setUsersModalChannel(null);
  }
  const mergeFormApi = useRef<FormApi | null>(null);
  const batchFormApi = useRef<FormApi | null>(null);

  function openCreate(parentId = 0) {
    setEditingRecord(null);
    setChannelType('list');
    setPageContent('');
    setChannelTemplates({});
    setModalVisible(true);
    // Form initValues 由 key 重置，父栏目通过 setTimeout 设置避免 Form 未挂载
    setTimeout(() => formApi.current?.setValue('parentId', parentId), 0);
  }

  function openEdit(record: CmsChannel) {
    setEditingRecord(record);
    setChannelType(record.type);
    setPageContent(record.pageContent ?? '');
    setChannelTemplates(channelTemplatesFromSettings(record.settings));
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditingRecord(null);
  }

  const formInitValues = editingRecord
    ? {
        parentId: editingRecord.parentId,
        name: editingRecord.name,
        slug: editingRecord.slug,
        type: editingRecord.type,
        modelId: editingRecord.modelId ?? undefined,
        linkUrl: editingRecord.linkUrl ?? '',
        pageSize: editingRecord.pageSize,
        sort: editingRecord.sort,
        visible: editingRecord.visible,
        status: editingRecord.status,
        seoTitle: editingRecord.seoTitle ?? '',
        seoKeywords: editingRecord.seoKeywords ?? '',
        seoDescription: editingRecord.seoDescription ?? '',
        listTemplate: editingRecord.listTemplate ?? undefined,
        detailTemplate: editingRecord.detailTemplate ?? undefined,
      }
    : { parentId: 0, type: 'list', pageSize: 20, sort: 0, visible: true, status: 'enabled' };

  async function handleModalOk() {
    if (!siteId) return;
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      return; // 校验失败保持抽屉打开
    }
    if (values.modelId === undefined) values.modelId = null;
    // 模板下拉清空后为 undefined，显式置 null 才能在更新时清除覆盖
    values.listTemplate = values.listTemplate ?? null;
    values.detailTemplate = values.detailTemplate ?? null;
    const payload: Record<string, unknown> = { ...values, pageContent };
    // 按通道模板覆盖并入 settings.templates（保留 formCode 等既有 settings 键）
    payload.settings = {
      ...(editingRecord?.settings ?? {}),
      templates: channelTemplatesToSettings(channelTemplates),
    };
    if (!editingRecord) payload.siteId = siteId;
    try {
      await saveMutation.mutateAsync({ id: editingRecord?.id, values: payload });
    } catch {
      return; // 错误提示由请求层统一 Toast，保持抽屉打开
    }
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  // ─── 模板试穿预览（?__template= 仅预览路径生效，不影响线上静态页）──────────
  function previewListTemplate() {
    if (!currentSite || !editingRecord) return;
    const tpl = (formApi.current?.getValue('listTemplate') as string | undefined) ?? '';
    const query = tpl ? `?__template=${encodeURIComponent(tpl)}` : '';
    window.open(`${cmsPreviewUrl(currentSite.code, `${editingRecord.path}/`)}${query}`, '_blank');
  }

  async function previewDetailTemplate() {
    if (!currentSite || !editingRecord) return;
    const tpl = (formApi.current?.getValue('detailTemplate') as string | undefined) ?? '';
    const data = await request
      .get<PaginatedResponse<CmsContent>>(`/api/cms/contents?siteId=${currentSite.id}&channelId=${editingRecord.id}&status=published&page=1&pageSize=1`)
      .then(unwrap)
      .catch(() => null);
    const content = data?.list?.[0];
    if (!content) {
      Toast.info('该栏目暂无已发布内容，无法预览详情模板');
      return;
    }
    const query = tpl ? `?__template=${encodeURIComponent(tpl)}` : '';
    window.open(`${cmsPreviewUrl(currentSite.code, `${editingRecord.path}/${content.slug || content.id}.html`)}${query}`, '_blank');
  }

  async function handleMergeOk() {
    const values = await mergeFormApi.current?.validate().catch(() => null);
    if (!values?.sourceIds || !(values.sourceIds as number[]).length || !values.targetId) throw new Error('validation');
    await mergeMutation.mutateAsync({ sourceIds: values.sourceIds as number[], targetId: values.targetId as number });
    setMergeModalVisible(false);
    Toast.success('合并完成，来源栏目已删除');
  }

  async function handleBatchCreateOk() {
    if (!siteId) return;
    const values = await batchFormApi.current?.validate().catch(() => null);
    if (!values?.names) throw new Error('validation');
    const names = String(values.names).split('\n').map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) {
      Toast.warning('请输入至少一个栏目名称');
      throw new Error('validation');
    }
    await batchCreateMutation.mutateAsync({ siteId, parentId: (values.parentId as number) ?? 0, names });
    setBatchModalVisible(false);
    Toast.success(`已创建 ${names.length} 个栏目（slug 自动取拼音）`);
  }

  const columns: ColumnProps<CmsChannel>[] = [
    { title: '栏目名称', dataIndex: 'name', width: 220 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (v: CmsChannel['type']) => {
        const color = v === 'list' ? 'blue' : v === 'page' ? 'purple' : 'orange';
        return <Tag size="small" color={color}>{CMS_CHANNEL_TYPE_LABELS[v]}</Tag>;
      },
    },
    { title: 'URL 路径', dataIndex: 'path', width: 180, render: (v: string) => `/${v}/` },
    { title: '绑定模型', dataIndex: 'modelName', width: 110, render: (v: string | null) => v ?? '-' },
    { title: '排序', dataIndex: 'sort', width: 70 },
    {
      title: '导航显示',
      dataIndex: 'visible',
      width: 90,
      render: (v: boolean) => (v ? <Tag size="small" color="green">显示</Tag> : <Tag size="small">隐藏</Tag>),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right',
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="red" size="small">停用</Tag>),
    },
    createOperationColumn<CmsChannel>({
      width: 240,
      desktopInlineKeys: ['addChild', 'edit', 'delete'],
      actions: (record) => [
        {
          key: 'visit',
          label: '访问',
          onClick: () => {
            if (currentSite) window.open(cmsPreviewUrl(currentSite.code, `${record.path}/`), '_blank');
          },
        },
        ...(hasPermission('cms:channel:create') ? [{
          key: 'addChild',
          label: '添加子栏目',
          onClick: () => openCreate(record.id),
        }] : []),
        ...(hasPermission('cms:channel:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(record),
        }, {
          key: 'users',
          label: '授权用户',
          onClick: () => openUsersModal(record),
        }] : []),
        ...(hasPermission('cms:channel:update') && record.type === 'list' ? [{
          key: 'clear',
          label: '清空栏目',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: `清空「${record.name}」？`,
              content: '栏目下全部内容将移入回收站（不含子栏目）',
              onOk: async () => {
                await clearMutation.mutateAsync(record.id);
                Toast.success('已清空，内容移入回收站');
              },
            });
          },
        }] : []),
        ...(hasPermission('cms:channel:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该栏目吗？',
              content: '需先清空子栏目与栏目下内容',
              onOk: () => handleDelete(record.id),
            });
          },
        }] : []),
      ],
    }),
  ];

  // 模板配置页签的通道来源（站点无通道记录时回退虚拟 PC 默认通道，与站点编辑页一致）
  const tplChannelTabs: { code: string; name: string }[] = (() => {
    const enabled = (publishChannels ?? []).filter((ch) => ch.status === 'enabled');
    if (enabled.length > 0) return enabled.map((ch) => ({ code: ch.code, name: ch.name }));
    return [{ code: CMS_DEFAULT_CHANNEL_CODE, name: 'PC 桌面' }];
  })();

  /** 单个发布通道的栏目级模板覆盖面板（动态字段名不走 Form，受控 state 管理） */
  const renderChannelTplPane = (ch: { code: string; name: string }) => {
    const cfg = channelTemplates[ch.code] ?? EMPTY_TPL_CONFIG;
    const patch = (p: Partial<ChannelTemplateConfig>) =>
      setChannelTemplates((s) => ({ ...s, [ch.code]: { ...(s[ch.code] ?? EMPTY_TPL_CONFIG), ...p } }));
    const rowStyle = { display: 'flex', alignItems: 'center', gap: 12 } as const;
    const labelStyle = { width: 130, flexShrink: 0, textAlign: 'right', fontSize: 14, color: 'var(--semi-color-text-0)' } as const;
    const listTplOptions = (themeTemplates?.list ?? []).map((t) => ({ value: t.name, label: t.label }));
    const detailTplOptions = (themeTemplates?.detail ?? []).map((t) => ({ value: t.name, label: t.label }));
    return (
      <TabPane tab={ch.name} itemKey={ch.code} key={ch.code}>
        <div style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={rowStyle}>
            <span style={labelStyle}>列表模板</span>
            <Select
              placeholder="跟随全通道通用"
              value={cfg.list ?? undefined}
              onChange={(v) => patch({ list: (v as string) ?? null })}
              showClear
              style={{ width: 300 }}
              optionList={listTplOptions}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>详情模板</span>
            <Select
              placeholder="跟随全通道通用"
              value={cfg.detail ?? undefined}
              onChange={(v) => patch({ detail: (v as string) ?? null })}
              showClear
              style={{ width: 300 }}
              optionList={detailTplOptions}
            />
          </div>
          {(models ?? []).map((m) => (
            <div style={rowStyle} key={m.id}>
              <span style={labelStyle}>{m.name}详情模板</span>
              <Select
                placeholder="跟随详情模板"
                value={cfg.detailByModel[m.code] ?? undefined}
                onChange={(v) => patch({ detailByModel: { ...cfg.detailByModel, [m.code]: (v as string) ?? null } })}
                showClear
                style={{ width: 300 }}
                optionList={detailTplOptions}
              />
            </div>
          ))}
        </div>
      </TabPane>
    );
  };

  return (
    <div className="page-container">
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={setSiteId} />
        {currentSite ? (
          <Button
            icon={<ExternalLink size={14} />}
            onClick={() => window.open(cmsPreviewUrl(currentSite.code), '_blank')}
          >
            访问站点
          </Button>
        ) : null}
        {hasPermission('cms:channel:update') ? (
          <Button icon={<Merge size={14} />} onClick={() => setMergeModalVisible(true)}>栏目合并</Button>
        ) : null}
        {hasPermission('cms:channel:create') ? (
          <Button icon={<ListPlus size={14} />} onClick={() => setBatchModalVisible(true)}>批量新增</Button>
        ) : null}
        {hasPermission('cms:channel:create') ? (
          <Button type="primary" icon={<Plus size={14} />} onClick={() => openCreate(0)}>新增栏目</Button>
        ) : null}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={tree}
        loading={treeQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无栏目，点击右上角「新增栏目」创建"
        scroll={{ x: 1090 }}
        onRefresh={() => void treeQuery.refetch()}
        refreshLoading={treeQuery.isFetching}
        pagination={false}
        expandAllRows
      />

      <SideSheet
        title={editingRecord ? '编辑栏目' : '新增栏目'}
        visible={modalVisible}
        onCancel={closeModal}
        width={720}
        closeOnEsc
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="tertiary" onClick={closeModal}>取消</Button>
            <Button type="primary" theme="solid" loading={saveMutation.isPending} onClick={() => void handleModalOk()}>保存</Button>
          </div>
        )}
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={formInitValues}
          onValueChange={(values) => {
            if (values.type !== channelType) setChannelType(values.type as string);
          }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Slot label="父栏目">
            <Form.TreeSelect
              field="parentId"
              noLabel
              style={{ width: '100%' }}
              treeData={[{ key: '0', value: 0, label: '顶级栏目' }, ...toTreeSelectData(tree, editingRecord?.id)]}
            />
          </Form.Slot>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input
                field="name"
                label="栏目名称"
                rules={[{ required: true, message: '请输入栏目名称' }]}
                onBlur={() => {
                  // 新建且 slug 为空时按名称自动生成拼音标识
                  if (editingRecord) return;
                  const api = formApi.current;
                  const name = api?.getValue('name');
                  if (typeof name === 'string' && name.trim() && !api?.getValue('slug')) {
                    api?.setValue('slug', slugifyName(name));
                  }
                }}
              />
            </Col>
            <Col span={12}>
              <Form.Input field="slug" label="URL 标识" placeholder="小写字母/数字/中划线" rules={[{ required: true, message: '请输入 URL 标识' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="type" label="栏目类型" style={{ width: '100%' }}
                optionList={[
                  { value: 'list', label: '列表栏目（挂内容）' },
                  { value: 'page', label: '单页栏目（富文本）' },
                  { value: 'link', label: '外链栏目（跳转）' },
                ]} />
            </Col>
            {channelType === 'list' ? (
              <Col span={12}>
                <Form.Select field="modelId" label="内容模型" style={{ width: '100%' }} showClear
                  optionList={(models ?? []).map((m) => ({ value: m.id, label: m.name }))} />
              </Col>
            ) : null}
            {channelType === 'link' ? (
              <Col span={12}>
                <Form.Input field="linkUrl" label="跳转地址" placeholder="https://..." rules={[{ required: true, message: '请输入跳转地址' }]} />
              </Col>
            ) : null}
            {channelType === 'list' ? (
              <Col span={12}>
                <Form.InputNumber field="pageSize" label="每页条数" min={1} max={100} style={{ width: '100%' }} />
              </Col>
            ) : null}
            <Col span={12}>
              <Form.InputNumber field="sort" label="排序" style={{ width: '100%' }} />
            </Col>
            <Col span={12}>
              <Form.Switch field="visible" label="导航显示" />
            </Col>
            <Col span={12}>
              <Form.RadioGroup field="status" label="状态">
                <Form.Radio value="enabled">启用</Form.Radio>
                <Form.Radio value="disabled">停用</Form.Radio>
              </Form.RadioGroup>
            </Col>
          </Row>
          {channelType === 'page' ? (
            <Form.Slot label="单页内容">
              <RichTextEditor value={pageContent} onChange={setPageContent} height={240} />
            </Form.Slot>
          ) : null}
          {channelType === 'list' ? (
            <Form.Section text="模板配置（按发布通道 × 内容模型；留空逐级回退：通道配置 → 全通道通用 → 站点默认 → 主题默认）">
              <Tabs type="card" size="small">
                <TabPane tab="全通道通用" itemKey="__common">
                  <Row gutter={16} style={{ paddingTop: 12 }}>
                    <Col span={12}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Form.Select field="listTemplate" label="列表模板" style={{ width: '100%' }} showClear
                            placeholder="跟随站点默认"
                            optionList={(themeTemplates?.list ?? []).map((t) => ({ value: t.name, label: t.label }))} />
                        </div>
                        {editingRecord ? (
                          <Button icon={<Eye size={14} />} title="以当前选中模板试穿预览栏目列表页（不影响线上）"
                            onClick={previewListTemplate}>预览</Button>
                        ) : null}
                      </div>
                    </Col>
                    <Col span={12}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Form.Select field="detailTemplate" label="详情模板" style={{ width: '100%' }} showClear
                            placeholder="跟随站点默认"
                            optionList={(themeTemplates?.detail ?? []).map((t) => ({ value: t.name, label: t.label }))} />
                        </div>
                        {editingRecord ? (
                          <Button icon={<Eye size={14} />} title="以当前选中模板试穿预览最新一篇已发布内容（不影响线上）"
                            onClick={() => void previewDetailTemplate()}>预览</Button>
                        ) : null}
                      </div>
                    </Col>
                  </Row>
                </TabPane>
                {tplChannelTabs.map((ch) => renderChannelTplPane(ch))}
              </Tabs>
            </Form.Section>
          ) : null}
          <Form.Section text="SEO 设置（留空继承站点默认）">
            <Form.Input field="seoTitle" label="SEO 标题" />
            <Form.Input field="seoKeywords" label="SEO 关键词" />
            <Form.TextArea field="seoDescription" label="SEO 描述" rows={2} />
          </Form.Section>
        </Form>
      </SideSheet>

      {/* 栏目合并 */}
      <AppModal
        title="栏目合并"
        visible={mergeModalVisible}
        onOk={handleMergeOk}
        onCancel={() => setMergeModalVisible(false)}
        okButtonProps={{ loading: mergeMutation.isPending }}
        width={520}
        closeOnEsc
      >
        <Form getFormApi={(api) => { mergeFormApi.current = api; }} allowEmpty labelPosition="left" labelWidth={90}>
          <Form.TreeSelect field="sourceIds" label="来源栏目" multiple style={{ width: '100%' }}
            treeData={toTreeSelectData(tree)}
            placeholder="内容将被迁出并删除的栏目（须为无子栏目的列表栏目）"
            rules={[{ required: true, message: '请选择来源栏目' }]} />
          <Form.TreeSelect field="targetId" label="目标栏目" style={{ width: '100%' }}
            treeData={toTreeSelectData(tree)}
            placeholder="内容并入的列表栏目"
            rules={[{ required: true, message: '请选择目标栏目' }]} />
        </Form>
      </AppModal>

      {/* 批量新增栏目 */}
      <AppModal
        title="批量新增栏目"
        visible={batchModalVisible}
        onOk={handleBatchCreateOk}
        onCancel={() => setBatchModalVisible(false)}
        okButtonProps={{ loading: batchCreateMutation.isPending }}
        width={520}
        closeOnEsc
      >
        <Form getFormApi={(api) => { batchFormApi.current = api; }} allowEmpty labelPosition="left" labelWidth={90}
          initValues={{ parentId: 0 }}>
          <Form.TreeSelect field="parentId" label="父栏目" style={{ width: '100%' }}
            treeData={[{ key: '0', value: 0, label: '顶级栏目' }, ...toTreeSelectData(tree)]} />
          <Form.TextArea field="names" label="栏目名称" rows={6}
            placeholder={'每行一个栏目名称，如：\n公司新闻\n行业动态\n通知公告\n\nURL 标识自动取拼音，路径冲突自动加序号'}
            rules={[{ required: true, message: '请输入栏目名称' }]} />
        </Form>
      </AppModal>

      {/* 栏目授权用户（P5 栏目级数据权限） */}
      <AppModal
        title={usersModalChannel ? `「${usersModalChannel.name}」授权用户` : '授权用户'}
        visible={!!usersModalChannel}
        onOk={handleUsersModalOk}
        onCancel={() => setUsersModalChannel(null)}
        okButtonProps={{ loading: setChannelUsersMutation.isPending, disabled: channelUsersQuery.isFetching }}
        width={520}
        closeOnEsc
      >
        <div style={{ marginBottom: 12, color: 'var(--semi-color-text-2)', fontSize: 13 }}>
          绑定用户后，仅超管与授权用户可管理该栏目下的内容（列表可见性与增删改均受限）；不绑定则不限制。
        </div>
        <Select
          multiple
          filter
          placeholder="选择授权用户"
          value={selectedUserIds}
          onChange={(v) => setSelectedUserIds((v as number[]) ?? [])}
          style={{ width: '100%' }}
          loading={channelUsersQuery.isFetching}
          optionList={(allUsers ?? []).map((u) => ({ value: u.id, label: `${u.nickname}（${u.username}）` }))}
        />
      </AppModal>
    </div>
  );
}
