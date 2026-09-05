import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Dropdown, Empty, Form, Spin, Tag, Toast, Row, Col, Select, Tooltip, Tree, Typography } from '@douyinfe/semi-ui';
import { IllustrationNoContent, IllustrationNoContentDark } from '@douyinfe/semi-illustrations';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree/interface';
import { Plus, ExternalLink, Merge, ListPlus, Eye, MoreHorizontal, RefreshCw } from 'lucide-react';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import AppModal from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import { useUrlSelectionParams } from '@/hooks/useUrlSelectionState';
import {
  useCmsChannelTree, useAllCmsModels, useAllCmsSites, useSaveCmsChannel, useDeleteCmsChannel,
  useCmsThemeTemplates, useMergeCmsChannels, useClearCmsChannel, useBatchCreateCmsChannels,
  useCmsChannelUsers, useSetCmsChannelUsers, useCmsChannelSampleContent,
} from '@/hooks/queries/cms';
import { useAllUsers } from '@/hooks/queries/users';
import { slugifyName } from '@/utils/slug';
import { confirmDelete as confirmDeleteModal } from '@/utils/confirm';
import { CMS_CHANNEL_DETAIL_PATH_RULE_LABELS, CMS_CHANNEL_DETAIL_PATH_RULES, CMS_CHANNEL_STATIC_MODE_LABELS, CMS_CHANNEL_STATIC_MODES, CMS_CHANNEL_TYPE_LABELS } from '@zenith/shared/cms';
import type { CmsChannel } from '@zenith/shared/cms';
import { CmsSiteSelect, cmsPreviewUrl } from './CmsSiteSelect';
import { CmsWidgetSourceRefsSheet, type CmsWidgetSourceTarget } from './CmsWidgetSourceRefsSheet';
import { abortSubmit } from '@/lib/abort-submit';

// 富文本引擎（wangeditor）压缩后约 266 KB，仅「单页」类型栏目用得到。
// 静态导入会让进入栏目管理就把它一并拉下来，故与公告页保持一致改为懒加载。
const RichTextEditor = lazy(() => import('@/components/RichTextEditor'));
const editorLoadingFallback = (
  <div
    style={{
      height: 240,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: '1px solid var(--semi-color-border)',
      borderRadius: 'var(--semi-border-radius-small)',
    }}
  >
    <Spin />
  </div>
);

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

/** 栏目树拍平为一维数组，用于按 id 反查最新栏目对象 */
function flattenChannels(nodes: CmsChannel[]): CmsChannel[] {
  return nodes.flatMap((n) => [n, ...(n.children ? flattenChannels(n.children) : [])]);
}

export default function ChannelsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  // 选中栏目以 ?site=&channel= 复合同步到 URL（栏目 id 不含站点上下文，深链单带 channel
  // 会落到 localStorage 恢复的站点而查无此栏目）；两参数同一 hook 实例原子写回。
  // 站点分两层：URL 层（深链 / 选中时盖章）优先，本地层承接站点选择器的恢复与手动切换——
  // 未选中栏目时站点是共享上下文默认值，不入 URL
  const [urlSelection, setUrlSelection] = useUrlSelectionParams(['site', 'channel']);
  const [localSiteId, setLocalSiteId] = useState<number | undefined>(undefined);
  const urlSiteId = urlSelection.site !== null ? Number(urlSelection.site) : undefined;
  const siteId = urlSiteId ?? localSiteId;
  const selectedId = urlSelection.channel === null ? null : Number(urlSelection.channel);
  const sampleContentMutation = useCmsChannelSampleContent();

  const treeQuery = useCmsChannelTree(siteId);
  const tree = useMemo(() => treeQuery.data ?? [], [treeQuery.data]);
  const { data: models } = useAllCmsModels(siteId);
  const { data: sites } = useAllCmsSites();
  const currentSite = sites?.find((s) => s.id === siteId);

  // 深链站点校验：站点清单落定后 URL 站点不可见（越权/已删/非法值）则整组清参，回退共享上下文
  useEffect(() => {
    if (urlSiteId === undefined || !sites) return;
    if (!sites.some((s) => s.id === urlSiteId)) setUrlSelection({ site: null, channel: null });
  }, [urlSiteId, sites, setUrlSelection]);

  const { data: themeTemplates } = useCmsThemeTemplates(currentSite?.effectiveTheme ?? currentSite?.theme, currentSite?.id);

  // 选中栏目以 ?site=&channel= 复合入 URL（见顶部声明）；新建态不入 URL
  /** 非 null 表示处于新建态，值为新栏目的父栏目 id（0 = 顶级） */
  const [createParentId, setCreateParentId] = useState<number | null>(null);
  const [channelType, setChannelType] = useState<string>('list');
  const [pageContent, setPageContent] = useState('');
  const saveMutation = useSaveCmsChannel();
  const deleteMutation = useDeleteCmsChannel();
  const mergeMutation = useMergeCmsChannels();
  const clearMutation = useClearCmsChannel();
  const batchCreateMutation = useBatchCreateCmsChannels();
  const [mergeModalVisible, setMergeModalVisible] = useState(false);
  const [batchModalVisible, setBatchModalVisible] = useState(false);
  const [widgetSourceTarget, setWidgetSourceTarget] = useState<CmsWidgetSourceTarget | null>(null);

  const flatChannels = useMemo(() => flattenChannels(tree), [tree]);
  // 编辑对象由 selectedId 从最新树数据派生，保存后 refetch 即可自动刷新，避免持有过期快照
  const editingRecord = createParentId === null
    ? flatChannels.find((c) => c.id === selectedId) ?? null
    : null;
  const editorOpen = createParentId !== null || editingRecord !== null;

  // 深链进入时补齐编辑态派生状态（点选路径由 openEdit 同步初始化并登记 ref，不会重跑，
  // 树刷新也不会覆盖未保存的类型/单页内容编辑）；树落定后目标仍不存在则仅清 channel 回退
  const initializedChannelIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (selectedId === null) {
      initializedChannelIdRef.current = null;
      return;
    }
    const record = flatChannels.find((c) => c.id === selectedId);
    if (!record) {
      // 数据在途（如新建保存后树未刷新完）时等待，避免误清刚保存的选中
      if (treeQuery.data && !treeQuery.isFetching) {
        setUrlSelection((prev) => ({ ...prev, channel: null }));
      }
      return;
    }
    if (initializedChannelIdRef.current === selectedId) return;
    initializedChannelIdRef.current = selectedId;
    setChannelType(record.type);
    setPageContent(record.pageContent ?? '');
  }, [selectedId, flatChannels, treeQuery.data, treeQuery.isFetching, setUrlSelection]);

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
    await setChannelUsersMutation.mutateAsync({ params: { id: usersModalChannel.id }, body: { userIds: selectedUserIds } });
    Toast.success('保存成功');
    setUsersModalChannel(null);
  }
  const mergeFormApi = useRef<FormApi | null>(null);
  const batchFormApi = useRef<FormApi | null>(null);

  function openCreate(parentId = 0) {
    setUrlSelection((prev) => ({ ...prev, channel: null }));
    setCreateParentId(parentId);
    setChannelType('list');
    setPageContent('');
  }

  function openEdit(record: CmsChannel) {
    setCreateParentId(null);
    initializedChannelIdRef.current = record.id;
    // 选中时把站点上下文一并盖章进 URL，深链完整可复现
    setUrlSelection({ site: siteId !== undefined ? String(siteId) : null, channel: String(record.id) });
    setChannelType(record.type);
    setPageContent(record.pageContent ?? '');
  }

  function closeEditor() {
    setCreateParentId(null);
    // 站点上下文降级到本地层再清 URL，避免回落到 localStorage 恢复的其他站点导致树切换
    setLocalSiteId(siteId);
    setUrlSelection({ site: null, channel: null });
  }

  // 站点切换会重挂载栏目树，同时清掉右侧编辑态；
  // 首次挂载的站点恢复（undefined → 存储值/默认值）不清，保住 ?channel= 深链
  function handleSiteChange(next: number) {
    const isSwitch = siteId !== undefined && siteId !== next;
    setLocalSiteId(next);
    if (isSwitch) {
      setCreateParentId(null);
      setUrlSelection({ site: null, channel: null });
    }
  }

  const formInitValues = editingRecord
    ? {
        parentId: editingRecord.parentId,
        name: editingRecord.name,
        code: editingRecord.code,
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
        staticMode: editingRecord.staticMode,
        detailPathRule: editingRecord.detailPathRule,
      }
    : { parentId: createParentId ?? 0, type: 'list', pageSize: 20, sort: 0, visible: true, status: 'enabled', staticMode: 'inherit', detailPathRule: 'none' };

  async function handleSave() {
    if (!siteId) return;
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      return; // 校验失败保持编辑区打开
    }
    if (values.modelId === undefined) values.modelId = null;
    // 栏目标识留空 → 不下发该字段，交给服务端按 slug 自动生成
    if (typeof values.code === 'string' && !values.code.trim()) delete values.code;
    // 模板下拉清空后为 undefined，显式置 null 才能在更新时清除覆盖
    values.listTemplate = values.listTemplate ?? null;
    values.detailTemplate = values.detailTemplate ?? null;
    const payload: Record<string, unknown> = { ...values, pageContent };
    if (!editingRecord) payload.siteId = siteId;
    let saved: CmsChannel;
    try {
      saved = await saveMutation.mutateAsync({ id: editingRecord?.id, values: payload });
    } catch {
      return; // 错误提示由请求层统一 Toast，保持编辑区打开
    }
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    // 新建成功后停留在该栏目的编辑态，方便继续补充模板/SEO
    setCreateParentId(null);
    initializedChannelIdRef.current = saved.id;
    setUrlSelection({ site: siteId !== undefined ? String(siteId) : null, channel: String(saved.id) });
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync({ params: { id } });
    if (selectedId === id) closeEditor();
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
    const data = await sampleContentMutation.mutateAsync({ siteId: currentSite.id, channelId: editingRecord.id })
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
    if (!values?.sourceIds || !(values.sourceIds as number[]).length || !values.targetId) abortSubmit('validation');
    await mergeMutation.mutateAsync({ body: { sourceIds: values.sourceIds as number[], targetId: values.targetId as number } });
    setMergeModalVisible(false);
    Toast.success('合并完成，来源栏目已删除');
  }

  async function handleBatchCreateOk() {
    if (!siteId) return;
    const values = await batchFormApi.current?.validate().catch(() => null);
    if (!values?.names) abortSubmit('validation');
    const names = String(values.names).split('\n').map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) {
      Toast.warning('请输入至少一个栏目名称');
      abortSubmit('validation');
    }
    const slugStrategy = (values.slugStrategy as 'initials' | 'pinyin') ?? 'initials';
    await batchCreateMutation.mutateAsync({ body: { siteId, parentId: (values.parentId as number) ?? 0, names, slugStrategy } });
    setBatchModalVisible(false);
    Toast.success(`已创建 ${names.length} 个栏目`);
  }

  const channelById = useMemo(() => new Map(flatChannels.map((c) => [c.id, c])), [flatChannels]);

  const channelTreeData: TreeNodeData[] = useMemo(() => {
    const build = (nodes: CmsChannel[]): TreeNodeData[] => nodes.map((n) => ({
      key: String(n.id),
      value: n.id,
      label: n.name,
      children: n.children?.length ? build(n.children) : undefined,
    }));
    return build(tree);
  }, [tree]);

  function confirmClear(record: CmsChannel) {
    confirmDeleteModal({
      title: `清空「${record.name}」？`,
      content: '栏目下全部内容将移入回收站（不含子栏目）',
      onOk: async () => {
        await clearMutation.mutateAsync({ params: { id: record.id } });
        Toast.success('已清空，内容移入回收站');
      },
    });
  }

  function confirmDelete(record: CmsChannel) {
    confirmDeleteModal({
      title: `确定要删除「${record.name}」吗？`,
      content: '需先清空子栏目与栏目下内容',
      onOk: () => handleDelete(record.id),
    });
  }

  const channelNodeMenu = (record: CmsChannel) => (
    <Dropdown.Menu>
      <Dropdown.Item
        disabled={!currentSite}
        onClick={() => { if (currentSite) window.open(cmsPreviewUrl(currentSite.code, `${record.path}/`), '_blank'); }}
      >
        访问前台
      </Dropdown.Item>
      {hasPermission('cms:widget:list') ? (
        <Dropdown.Item
          onClick={() => setWidgetSourceTarget({ type: 'channel', id: record.id, name: record.name })}
        >
          页面部件引用
        </Dropdown.Item>
      ) : null}
      {hasPermission('cms:channel:create') ? (
        <Dropdown.Item onClick={() => openCreate(record.id)}>添加子栏目</Dropdown.Item>
      ) : null}
      {hasPermission('cms:channel:update') ? (
        <Dropdown.Item onClick={() => openUsersModal(record)}>授权用户</Dropdown.Item>
      ) : null}
      {hasPermission('cms:channel:update') && record.type === 'list' ? (
        <Dropdown.Item type="danger" onClick={() => confirmClear(record)}>清空栏目</Dropdown.Item>
      ) : null}
      {hasPermission('cms:channel:delete') ? (
        <>
          <Dropdown.Divider />
          <Dropdown.Item type="danger" onClick={() => confirmDelete(record)}>删除</Dropdown.Item>
        </>
      ) : null}
    </Dropdown.Menu>
  );

  /** 树节点：名称 + 类型/隐藏/停用标记 + 行内操作菜单 */
  const renderChannelLabel = (label?: ReactNode, data?: TreeNodeData) => {
    const record = data ? channelById.get(Number(data.key)) : undefined;
    if (!record) return label;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', minWidth: 0 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: record.status === 'disabled' ? 'var(--semi-color-text-2)' : undefined,
          }}
          title={`${record.name}\n栏目标识：${record.code}\n路径：/${record.path}/`}
        >
          {label}
        </span>
        {record.type === 'list' ? null : (
          <Tag size="small" color={record.type === 'page' ? 'purple' : 'orange'}>
            {CMS_CHANNEL_TYPE_LABELS[record.type]}
          </Tag>
        )}
        {record.visible ? null : (
          <Tooltip content="不在前台导航中显示"><Tag size="small">隐藏</Tag></Tooltip>
        )}
        {record.status === 'disabled' ? <Tag size="small" color="red">停用</Tag> : null}
        <Dropdown trigger="click" clickToHide stopPropagation position="bottomRight" render={channelNodeMenu(record)}>
          <Button
            size="small"
            theme="borderless"
            type="tertiary"
            icon={<MoreHorizontal size={13} />}
            onClick={(e) => e.stopPropagation()}
          />
        </Dropdown>
      </div>
    );
  };

  const editorForm = (
    <Form
      key={editingRecord ? `edit-${editingRecord.id}` : `create-${createParentId ?? 0}`}
      getFormApi={(api) => { formApi.current = api; }}
      allowEmpty
      initValues={formInitValues}
      onValueChange={(values) => {
        if (values.type !== channelType) setChannelType(values.type as string);
      }}
      labelPosition="left"
      labelWidth={110}
    >
      <Form.TreeSelect
        field="parentId"
        label="父栏目"
        style={{ width: '100%' }}
        treeData={[{ key: '0', value: 0, label: '顶级栏目' }, ...toTreeSelectData(tree, editingRecord?.id)]}
      />
      <Row gutter={16}>
        <Col span={24} lg={12}>
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
        <Col span={24} lg={12}>
          <Form.Input field="slug" label="URL 标识" placeholder="小写字母/数字/中划线" rules={[{ required: true, message: '请输入 URL 标识' }]} />
        </Col>
        <Col span={24} lg={12}>
          <Form.Input
            field="code"
            label="栏目标识"
            placeholder="留空自动取 URL 标识"
          />
        </Col>
        <Col span={24} lg={12}>
          <Form.Select field="type" label="栏目类型" style={{ width: '100%' }}
            optionList={[
              { value: 'list', label: '列表栏目（挂内容）' },
              { value: 'page', label: '单页栏目（富文本）' },
              { value: 'link', label: '外链栏目（跳转）' },
            ]} />
        </Col>
        {channelType === 'list' ? (
          <Col span={24} lg={12}>
            <Form.Select field="modelId" label="内容模型" style={{ width: '100%' }} showClear
              optionList={(models ?? []).map((m) => ({ value: m.id, label: m.name }))} />
          </Col>
        ) : null}
        {channelType === 'link' ? (
          <Col span={24} lg={12}>
            <Form.Input field="linkUrl" label="跳转地址" placeholder="https://..." rules={[{ required: true, message: '请输入跳转地址' }]} />
          </Col>
        ) : null}
        {channelType === 'list' ? (
          <Col span={24} lg={12}>
            <Form.InputNumber field="pageSize" label="每页条数" min={1} max={100} style={{ width: '100%' }} />
          </Col>
        ) : null}
        {channelType !== 'link' ? (
          <Col span={24} lg={12}>
            <Form.Select
              field="staticMode"
              label="静态化模式"
              style={{ width: '100%' }}
              optionList={CMS_CHANNEL_STATIC_MODES.map((mode) => ({
                label: CMS_CHANNEL_STATIC_MODE_LABELS[mode],
                value: mode,
              }))}
              extraText="选择「动态渲染」后本栏目不产出静态文件，始终走 SSR"
            />
          </Col>
        ) : null}
        {channelType === 'list' ? (
          <Col span={24} lg={12}>
            <Form.Select
              field="detailPathRule"
              label="详情页归档"
              style={{ width: '100%' }}
              optionList={CMS_CHANNEL_DETAIL_PATH_RULES.map((rule) => ({
                label: CMS_CHANNEL_DETAIL_PATH_RULE_LABELS[rule],
                value: rule,
              }))}
              extraText="按日期/散列把详情页打散到子目录；内容自填静态路径时不生效。改动后需整站重建"
            />
          </Col>
        ) : null}
        <Col span={24} lg={12}>
          <Form.InputNumber field="sort" label="排序" style={{ width: '100%' }} />
        </Col>
        <Col span={24} lg={12}>
          <Form.Switch field="visible" label="导航显示" />
        </Col>
        <Col span={24} lg={12}>
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
        </Col>
      </Row>
      {channelType === 'page' ? (
        <Form.Slot label="单页内容">
          <Suspense fallback={editorLoadingFallback}>
            <RichTextEditor value={pageContent} onChange={setPageContent} height={240} />
          </Suspense>
        </Form.Slot>
      ) : null}
      {channelType === 'list' ? (
        <Form.Section text="模板配置（留空逐级回退：栏目 → 站点默认 → 主题默认）">
          <Row gutter={16} style={{ paddingTop: 12 }}>
            <Col span={24}>
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
            <Col span={24}>
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
        </Form.Section>
      ) : null}
      <Form.Section text="SEO 设置（留空继承站点默认）">
        <Form.Input field="seoTitle" label="SEO 标题" />
        <Form.Input field="seoKeywords" label="SEO 关键词" />
        <Form.TextArea field="seoDescription" label="SEO 描述" rows={2} />
      </Form.Section>
    </Form>
  );

  // ─── 左侧：站点 + 栏目树（栏目域的全部操作都归左栏，右栏专注单个栏目编辑）────
  const treeActionsMenu = (
    <Dropdown.Menu>
      {hasPermission('cms:channel:create') ? (
        <Dropdown.Item icon={<ListPlus size={14} />} onClick={() => setBatchModalVisible(true)}>批量新增</Dropdown.Item>
      ) : null}
      {hasPermission('cms:channel:update') ? (
        <Dropdown.Item icon={<Merge size={14} />} onClick={() => setMergeModalVisible(true)}>栏目合并</Dropdown.Item>
      ) : null}
      <Dropdown.Item
        icon={<RefreshCw size={14} />}
        onClick={() => void treeQuery.refetch()}
      >
        刷新栏目树
      </Dropdown.Item>
      <Dropdown.Divider />
      <Dropdown.Item
        icon={<ExternalLink size={14} />}
        disabled={!currentSite}
        onClick={() => { if (currentSite) window.open(cmsPreviewUrl(currentSite.code), '_blank'); }}
      >
        访问站点
      </Dropdown.Item>
    </Dropdown.Menu>
  );

  const masterPanel = (
    <>
      <MasterDetailLayout.Header
        extra={(
          <>
            {hasPermission('cms:channel:create') ? (
              <Tooltip content="新增顶级栏目">
                <Button size="small" theme="borderless" icon={<Plus size={16} />} onClick={() => openCreate(0)} />
              </Tooltip>
            ) : null}
            <Dropdown trigger="click" clickToHide position="bottomRight" render={treeActionsMenu}>
              <Button size="small" theme="borderless" type="tertiary" icon={<MoreHorizontal size={16} />} />
            </Dropdown>
          </>
        )}
      >
        <CmsSiteSelect value={siteId} onChange={handleSiteChange} width="100%" />
      </MasterDetailLayout.Header>
      <MasterDetailLayout.Body padding={8}>
        {siteId === undefined ? (
          <Typography.Text type="tertiary" style={{ display: 'block', padding: '24px 8px', textAlign: 'center' }}>
            请先选择站点
          </Typography.Text>
        ) : channelTreeData.length === 0 ? (
          <Typography.Text type="tertiary" style={{ display: 'block', padding: '24px 8px', textAlign: 'center' }}>
            {treeQuery.isFetching ? '加载中…' : '暂无栏目，点击右上角「+」创建'}
          </Typography.Text>
        ) : (
          <Tree
            treeData={channelTreeData}
            value={selectedId === null ? '' : String(selectedId)}
            filterTreeNode
            showFilteredOnly
            searchPlaceholder="搜索栏目名称"
            defaultExpandAll
            renderLabel={renderChannelLabel}
            onSelect={(key) => {
              const record = channelById.get(Number(key));
              if (record) openEdit(record);
            }}
            style={{ width: '100%' }}
          />
        )}
      </MasterDetailLayout.Body>
    </>
  );

  // ─── 右侧：栏目编辑区 ──────────────────────────────────────────────────────
  const detailPanel = editorOpen ? (
    <>
      <MasterDetailLayout.Header
        extra={(
          <>
            <Button type="tertiary" onClick={closeEditor}>取消</Button>
            <Button type="primary" theme="solid" loading={saveMutation.isPending} onClick={() => void handleSave()}>
              保存
            </Button>
          </>
        )}
      >
        <Typography.Text strong ellipsis={{ showTooltip: true }} style={{ maxWidth: 320 }}>
          {editingRecord ? editingRecord.name : '新增栏目'}
        </Typography.Text>
      </MasterDetailLayout.Header>
      <MasterDetailLayout.Body padding="16px 20px">
        <div style={{ maxWidth: 900 }}>
          {editorForm}
        </div>
      </MasterDetailLayout.Body>
    </>
  ) : (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Empty
        image={<IllustrationNoContent style={{ width: 140, height: 140 }} />}
        darkModeImage={<IllustrationNoContentDark style={{ width: 140, height: 140 }} />}
        title="未选择栏目"
        description="从左侧栏目树选择一个栏目进行编辑，或点击「新增栏目」创建"
      />
    </div>
  );

  return (
    <div className="page-container page-container--stretch">
      <MasterDetailLayout
        persistKey="cms-channels"
        defaultSize={300}
        minSize={220}
        maxSize={460}
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        showDetail={editorOpen}
        onBack={closeEditor}
        master={masterPanel}
        detail={detailPanel}
      />

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
          initValues={{ parentId: 0, slugStrategy: 'initials' }}>
          <Form.TreeSelect field="parentId" label="父栏目" style={{ width: '100%' }}
            treeData={[{ key: '0', value: 0, label: '顶级栏目' }, ...toTreeSelectData(tree)]} />
          <Form.RadioGroup field="slugStrategy" label="URL 标识">
            <Form.Radio value="initials">首字母缩写（政务公开 → zwgk）</Form.Radio>
            <Form.Radio value="pinyin">逐字全拼（政务公开 → zheng-wu-gong-kai）</Form.Radio>
          </Form.RadioGroup>
          <Form.TextArea field="names" label="栏目名称" rows={6}
            placeholder={'每行一个栏目，支持「名称|slug」显式指定标识，如：\n政务公开\n通知公告|tzgg\n新闻中心|news\n\n未指定 slug 时按上方策略自动生成，路径冲突自动加序号'}
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
      <CmsWidgetSourceRefsSheet
        target={widgetSourceTarget}
        onClose={() => setWidgetSourceTarget(null)}
      />
    </div>
  );
}
