import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Form, Input, InputNumber, Select, Switch, Tag, TextArea, Toast, Modal, Row, Col, SideSheet, Tabs, TabPane, Upload } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus, Upload as UploadIcon, ImageUp, Zap, ExternalLink } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import { useAllUsers } from '@/hooks/queries/users';
import {
  useCmsSiteList, useCmsThemes, useSaveCmsSite, useDeleteCmsSite, cmsSiteKeys,
  useCmsSiteUsers, useSetCmsSiteUsers, useEnableSiteAnalytics, useImportCmsSite,
  useCmsThemeTemplates, useAllCmsModels, useCmsPublishChannels, useCmsSiteTemplateHealth,
  useCmsThemeSettingsSchema, useCmsStaticBuild,
} from '@/hooks/queries/cms';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';
import { useWorkflowDefinitionList } from '@/hooks/queries/workflow-definitions';
import { CMS_STATIC_MODE_LABELS, CMS_STATIC_MODES, CMS_DEFAULT_CHANNEL_CODE } from '@zenith/shared';
import type { AsyncTask, CmsSite, CmsSiteTemplateDefaults, CmsInvalidTemplateRef, CmsThemeSettingField } from '@zenith/shared';
import { cmsPreviewUrl } from './CmsSiteSelect';

interface SearchParams {
  keyword: string;
  status: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

interface ChannelTemplateConfig {
  list: string | null;
  detail: string | null;
  detailByModel: Record<string, string | null>;
}

/** 站点默认模板编辑态（key = 发布通道编码；受控管理，字段名含动态编码不走 Form） */
type TemplateDefaultsState = Record<string, ChannelTemplateConfig>;

const EMPTY_CHANNEL_CONFIG: ChannelTemplateConfig = { list: null, detail: null, detailByModel: {} };

function templateDefaultsFromSettings(settings: Record<string, unknown> | null | undefined): TemplateDefaultsState {
  const state: TemplateDefaultsState = {};
  const all = settings?.defaultTemplates as Record<string, CmsSiteTemplateDefaults | undefined> | undefined;
  for (const [code, cfg] of Object.entries(all ?? {})) {
    if (!cfg) continue;
    state[code] = {
      list: cfg.list ?? null,
      detail: cfg.detail ?? null,
      detailByModel: { ...(cfg.detailByModel ?? {}) },
    };
  }
  return state;
}

/** 序列化为 settings.defaultTemplates（去掉空值，保持 JSONB 干净） */
function templateDefaultsToSettings(state: TemplateDefaultsState): Record<string, CmsSiteTemplateDefaults> {
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

/** settings.langLinks → 每行 `语言代码=站点标识` 文本（表单编辑态） */
function langLinksToText(v: unknown): string {
  if (!Array.isArray(v)) return '';
  return v
    .map((l) => {
      const o = l as { language?: unknown; siteCode?: unknown };
      return typeof o.language === 'string' && typeof o.siteCode === 'string' ? `${o.language}=${o.siteCode}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

/** 每行 `语言代码=站点标识` 文本 → settings.langLinks */
function parseLangLinks(text: string): { language: string; siteCode: string }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf('=');
      if (i <= 0) return null;
      const language = line.slice(0, i).trim();
      const siteCode = line.slice(i + 1).trim();
      return language && siteCode ? { language, siteCode } : null;
    })
    .filter((x): x is { language: string; siteCode: string } => !!x);
}

/** 主题参数编辑态 → settings.themeConfig（剔除空值，保持 JSONB 干净） */
function cleanThemeConfig(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

/** 失效模板引用的人类可读描述（健康检查 Banner 用） */
function describeInvalidRef(ref: CmsInvalidTemplateRef): string {
  const prefix = ref.source === 'channel' && ref.channelName ? `栏目「${ref.channelName}」` : '';
  const suffix = ref.source === 'content' && ref.count ? `（${ref.count} 条内容）` : '';
  return `${prefix}${ref.location}「${ref.template}」${suffix}`;
}

/** 站点静态化面板（SideSheet 打开时才挂载，任务列表轮询随关闭停止） */
function SiteStaticPanel({ site, canBuild }: { site: CmsSite; canBuild: boolean }) {
  const buildMutation = useCmsStaticBuild();
  const { tasks, loading, refresh } = useMyAsyncTasks({ taskTypes: ['cms-static-build', 'cms-theme-rebuild'] });
  const siteTasks = tasks.filter((t) => {
    const payload = t.payload as { siteId?: number; siteIds?: number[] };
    return payload.siteId === site.id || (Array.isArray(payload.siteIds) && payload.siteIds.includes(site.id));
  });

  async function handleBuild() {
    await buildMutation.mutateAsync(site.id);
    Toast.success('任务已提交，可在下方列表查看进度');
    void refresh();
  }

  const columns: ColumnProps<AsyncTask>[] = [
    { title: '任务', dataIndex: 'title', width: 200, render: renderEllipsis },
    { title: '进度', width: 230, render: (_: unknown, record) => <AsyncTaskProgress task={record} /> },
    { title: '提交时间', dataIndex: 'createdAt', width: 180 },
    { title: '完成时间', dataIndex: 'completedAt', width: 180, render: (v: string | null) => v ?? '-' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Banner
        type="info"
        closeIcon={null}
        description={(
          <span>
            全站静态化会将首页、全部栏目分页、全部已发布内容、sitemap.xml、robots.txt 渲染为静态 HTML 文件。
            当前静态化模式：<b>{CMS_STATIC_MODE_LABELS[site.staticMode]}</b>。
            混合模式下内容发布时已自动增量生成，全量生成用于模板/碎片/导航变更后的整站刷新（主题代码变更已由系统自动检测重建）。
          </span>
        )}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        {canBuild ? (
          <Button type="primary" icon={<Zap size={14} />} loading={buildMutation.isPending} onClick={() => void handleBuild()}>
            全站生成
          </Button>
        ) : null}
        <Button icon={<ExternalLink size={14} />} onClick={() => window.open(cmsPreviewUrl(site.code), '_blank')}>访问站点</Button>
      </div>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={siteTasks}
        loading={loading}
        rowKey="id"
        size="small"
        empty="该站点暂无静态化任务"
        onRefresh={() => void refresh()}
        refreshLoading={loading}
        pagination={false}
      />
    </div>
  );
}

export default function SitesPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();

  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const listQuery = useCmsSiteList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const { data: themes } = useCmsThemes();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsSite | null>(null);
  const [activeTab, setActiveTab] = useState('basic');
  // 模板下拉跟随表单里实时选中的主题（Form 值不具备响应性，用 state 镜像）
  const [selectedTheme, setSelectedTheme] = useState('default');
  const [templateDefaults, setTemplateDefaults] = useState<TemplateDefaultsState>({});
  // 主题参数编辑态（settings.themeConfig；动态字段名不走 Form，受控管理）
  const [themeConfig, setThemeConfig] = useState<Record<string, unknown>>({});
  const { data: themeTemplates } = useCmsThemeTemplates(modalVisible ? selectedTheme : undefined);
  const { data: themeSettingsSchema } = useCmsThemeSettingsSchema(modalVisible ? selectedTheme : undefined);
  const { data: allModels } = useAllCmsModels();
  // 站点发布通道（模板页签动态渲染；新建站点回退虚拟 PC 默认通道）
  const { data: sitePublishChannels } = useCmsPublishChannels(editingRecord?.id, modalVisible);
  // 模板健康检查：按当前选中主题扫描栏目/内容级失效引用（切主题即预检）
  const { data: templateHealth } = useCmsSiteTemplateHealth(editingRecord?.id, selectedTheme, modalVisible);
  const saveMutation = useSaveCmsSite();
  const deleteMutation = useDeleteCmsSite();
  const importMutation = useImportCmsSite();
  const importFileRef = useRef<HTMLInputElement>(null);

  // 主题模板清单加载后，自动清理本地编辑态中在该主题下失效的站点级模板引用（保存即生效，后端也会校验拦截）
  useEffect(() => {
    if (!modalVisible || !themeTemplates) return;
    const validList = new Set(themeTemplates.list.map((t) => t.name));
    const validDetail = new Set(themeTemplates.detail.map((t) => t.name));
    const removed: string[] = [];
    const cleaned: TemplateDefaultsState = {};
    for (const [code, cfg] of Object.entries(templateDefaults)) {
      const detailByModel = Object.fromEntries(
        Object.entries(cfg.detailByModel).filter(([model, v]) => {
          if (!v || validDetail.has(v)) return true;
          removed.push(`[${code}]${model} 详情模板「${v}」`);
          return false;
        }),
      );
      if (cfg.list && !validList.has(cfg.list)) removed.push(`[${code}]列表模板「${cfg.list}」`);
      if (cfg.detail && !validDetail.has(cfg.detail)) removed.push(`[${code}]详情模板「${cfg.detail}」`);
      cleaned[code] = {
        list: cfg.list && validList.has(cfg.list) ? cfg.list : null,
        detail: cfg.detail && validDetail.has(cfg.detail) ? cfg.detail : null,
        detailByModel,
      };
    }
    if (removed.length > 0) {
      setTemplateDefaults(cleaned);
      Toast.warning({ content: `已清除 ${removed.length} 项在主题「${selectedTheme}」下失效的默认模板配置：${removed.join('、')}（保存后生效）`, duration: 6 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在主题清单变化时清理，避免编辑操作反复触发
  }, [themeTemplates, modalVisible]);

  // ─── 授权用户（站点级数据权限）────────────────────────────────────────────
  const [usersModalSite, setUsersModalSite] = useState<CmsSite | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  // 静态化面板（原独立「静态化管理」页面整合至此）
  const [staticSheetSite, setStaticSheetSite] = useState<CmsSite | null>(null);
  const siteUsersQuery = useCmsSiteUsers(usersModalSite?.id, !!usersModalSite);
  const setSiteUsersMutation = useSetCmsSiteUsers();
  const enableAnalyticsMutation = useEnableSiteAnalytics();
  const { data: defsPage } = useWorkflowDefinitionList({ page: 1, pageSize: 100, status: 'published' });
  const publishedDefs = defsPage?.list;
  const { data: allUsers } = useAllUsers({ enabled: !!usersModalSite });
  const siteUserIds = siteUsersQuery.data?.userIds;
  const usersInitialized = useRef(false);
  if (usersModalSite && siteUserIds && !usersInitialized.current) {
    usersInitialized.current = true;
    setSelectedUserIds(siteUserIds);
  }

  function openUsersModal(record: CmsSite) {
    usersInitialized.current = false;
    setSelectedUserIds([]);
    setUsersModalSite(record);
  }

  async function handleUsersModalOk() {
    if (!usersModalSite) return;
    await setSiteUsersMutation.mutateAsync({ siteId: usersModalSite.id, userIds: selectedUserIds });
    Toast.success('保存成功');
    setUsersModalSite(null);
  }

  function handleSearch() {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: cmsSiteKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    void queryClient.invalidateQueries({ queryKey: cmsSiteKeys.lists });
  }

  function openCreate() {
    setEditingRecord(null);
    setActiveTab('basic');
    setSelectedTheme('default');
    setTemplateDefaults({});
    setThemeConfig({});
    setModalVisible(true);
  }

  function openEdit(record: CmsSite) {
    setEditingRecord(record);
    setActiveTab('basic');
    setSelectedTheme(record.theme);
    setTemplateDefaults(templateDefaultsFromSettings(record.settings));
    setThemeConfig({ ...((record.settings as Record<string, unknown>)?.themeConfig as Record<string, unknown> ?? {}) });
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditingRecord(null);
  }

  const formInitValues = editingRecord
    ? {
        name: editingRecord.name,
        code: editingRecord.code,
        domain: editingRecord.domain ?? '',
        aliasDomains: editingRecord.aliasDomains,
        isDefault: editingRecord.isDefault,
        theme: editingRecord.theme,
        staticMode: editingRecord.staticMode,
        status: editingRecord.status,
        title: editingRecord.title ?? '',
        keywords: editingRecord.keywords ?? '',
        description: editingRecord.description ?? '',
        icp: editingRecord.icp ?? '',
        copyright: editingRecord.copyright ?? '',
        robots: editingRecord.robots ?? '',
        remark: editingRecord.remark ?? '',
        baiduPushToken: String((editingRecord.settings as Record<string, unknown>)?.baiduPushToken ?? ''),
        indexNowKey: String((editingRecord.settings as Record<string, unknown>)?.indexNowKey ?? ''),
        themePrimary: String((editingRecord.settings as Record<string, unknown>)?.themePrimary ?? ''),
        themeDark: String((editingRecord.settings as Record<string, unknown>)?.themeDark ?? 'light'),
        auditMode: String((editingRecord.settings as Record<string, unknown>)?.auditMode ?? 'simple'),
        auditWorkflowDefinitionId: (editingRecord.settings as Record<string, unknown>)?.auditWorkflowDefinitionId as number | undefined,
        imageMaxWidth: Number((editingRecord.settings as Record<string, unknown>)?.imageMaxWidth ?? 1600),
        watermarkEnabled: (editingRecord.settings as Record<string, unknown>)?.watermarkEnabled === true,
        watermarkText: String((editingRecord.settings as Record<string, unknown>)?.watermarkText ?? ''),
        watermarkPosition: String((editingRecord.settings as Record<string, unknown>)?.watermarkPosition ?? 'southeast'),
        watermarkOpacity: Number((editingRecord.settings as Record<string, unknown>)?.watermarkOpacity ?? 45),
        thumbEnabled: (editingRecord.settings as Record<string, unknown>)?.thumbEnabled === true,
        thumbWidth: Number((editingRecord.settings as Record<string, unknown>)?.thumbWidth ?? 400),
        webhookUrl: String((editingRecord.settings as Record<string, unknown>)?.webhookUrl ?? ''),
        webhookSecret: String((editingRecord.settings as Record<string, unknown>)?.webhookSecret ?? ''),
        captchaEnabled: (editingRecord.settings as Record<string, unknown>)?.captchaEnabled === true,
        cdnPurgeUrl: String((editingRecord.settings as Record<string, unknown>)?.cdnPurgeUrl ?? ''),
        cdnPurgeToken: String((editingRecord.settings as Record<string, unknown>)?.cdnPurgeToken ?? ''),
        language: String((editingRecord.settings as Record<string, unknown>)?.language ?? ''),
        langLinksText: langLinksToText((editingRecord.settings as Record<string, unknown>)?.langLinks),
      }
    : {
        theme: 'default', staticMode: 'hybrid', status: 'enabled', isDefault: false, aliasDomains: [],
        themeDark: 'light', imageMaxWidth: 1600, watermarkEnabled: false, watermarkPosition: 'southeast',
        watermarkOpacity: 45, thumbEnabled: false, thumbWidth: 400, auditMode: 'simple',
      };

  async function handleSave() {
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      // 必填项（站点名称/标识）都在基础信息页，校验失败跳回该页
      setActiveTab('basic');
      return;
    }
    if (!values.domain) values.domain = null;
    // 推送凭证/主题参数/图片处理/默认模板并入 settings JSONB（保留既有 settings 键；剔除已下线的 h5 旧键）
    const {
      baiduPushToken, indexNowKey, themePrimary, themeDark,
      imageMaxWidth, watermarkEnabled, watermarkText, watermarkPosition, watermarkOpacity, thumbEnabled, thumbWidth,
      auditMode, auditWorkflowDefinitionId,
      webhookUrl, webhookSecret, captchaEnabled,
      cdnPurgeUrl, cdnPurgeToken, language, langLinksText,
      ...rest
    } = values;
    const { h5Enabled: _legacyH5Enabled, h5Domain: _legacyH5Domain, ...prevSettings } = (editingRecord?.settings ?? {}) as Record<string, unknown>;
    rest.settings = {
      ...prevSettings,
      baiduPushToken: String(baiduPushToken ?? '').trim(),
      indexNowKey: String(indexNowKey ?? '').trim(),
      themePrimary: String(themePrimary ?? '').trim(),
      themeDark: themeDark ?? 'light',
      imageMaxWidth: Number(imageMaxWidth ?? 1600),
      watermarkEnabled: watermarkEnabled === true,
      watermarkText: String(watermarkText ?? '').trim(),
      watermarkPosition: watermarkPosition ?? 'southeast',
      watermarkOpacity: Number(watermarkOpacity ?? 45),
      thumbEnabled: thumbEnabled === true,
      thumbWidth: Number(thumbWidth ?? 400),
      auditMode: auditMode ?? 'simple',
      auditWorkflowDefinitionId: auditWorkflowDefinitionId ?? null,
      webhookUrl: String(webhookUrl ?? '').trim(),
      webhookSecret: String(webhookSecret ?? '').trim(),
      captchaEnabled: captchaEnabled === true,
      cdnPurgeUrl: String(cdnPurgeUrl ?? '').trim(),
      cdnPurgeToken: String(cdnPurgeToken ?? '').trim(),
      language: String(language ?? '').trim(),
      langLinks: parseLangLinks(String(langLinksText ?? '')),
      defaultTemplates: templateDefaultsToSettings(templateDefaults),
      themeConfig: cleanThemeConfig(themeConfig),
    };
    // 主题参数变更 + 非纯动态站点 → 保存后提示重新生成静态页
    const prevThemeConfig = JSON.stringify(cleanThemeConfig((prevSettings.themeConfig as Record<string, unknown>) ?? {}));
    const themeConfigChanged = editingRecord !== null && prevThemeConfig !== JSON.stringify(cleanThemeConfig(themeConfig));
    let saved: CmsSite;
    try {
      saved = await saveMutation.mutateAsync({ id: editingRecord?.id, values: rest });
    } catch {
      return; // 错误提示由请求层统一 Toast
    }
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    closeModal();
    if (themeConfigChanged && saved.staticMode !== 'dynamic') {
      Modal.confirm({
        title: '重新生成静态页？',
        content: '主题参数已变更，已生成的静态页仍是旧样式。是否立即提交全站静态化任务？',
        okText: '立即生成',
        cancelText: '稍后手动',
        onOk: async () => {
          await request.post(`/api/cms/static/build`, { siteId: saved.id }).then(unwrap);
          Toast.success('静态化任务已提交，可在任务中心查看进度');
        },
      });
    }
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  // ─── 站点导入导出（P5 整站备份迁移）────────────────────────────────────────
  function handleExport(record: CmsSite) {
    void request.download(`/api/cms/sites/${record.id}/export`, `cms-site-${record.code}-${Date.now()}.json`)
      .catch(() => Toast.error('导出失败'));
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(await file.text()) as Record<string, unknown>;
    } catch {
      Toast.error('文件不是有效的 JSON');
      return;
    }
    try {
      const result = await importMutation.mutateAsync(pkg);
      Toast.success(`站点「${result.siteName}」导入成功（栏目 ${result.counts.channels ?? 0}、内容 ${result.counts.contents ?? 0}）`);
    } catch {
      // 错误提示由请求层统一 Toast
    }
  }

  const columns: ColumnProps<CmsSite>[] = [
    { title: '站点名称', dataIndex: 'name', width: 160 },
    {
      title: '标识',
      dataIndex: 'code',
      width: 110,
      render: (v: string, record) => (
        <span>
          {v}
          {record.isDefault ? <Tag size="small" color="green" style={{ marginLeft: 6 }}>默认</Tag> : null}
        </span>
      ),
    },
    {
      title: '域名',
      dataIndex: 'domain',
      width: 180,
      render: (v: string | null) => v || <span style={{ color: 'var(--semi-color-text-2)' }}>未绑定</span>,
    },
    { title: '主题', dataIndex: 'theme', width: 100 },
    {
      title: '静态化模式',
      dataIndex: 'staticMode',
      width: 130,
      render: (v: CmsSite['staticMode']) => CMS_STATIC_MODE_LABELS[v],
    },
    { title: 'SEO 标题', dataIndex: 'title', width: 220, render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right',
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="red" size="small">停用</Tag>),
    },
    createOperationColumn<CmsSite>({
      width: 240,
      desktopInlineKeys: ['visit', 'edit', 'delete'],
      actions: (record) => [
        {
          key: 'visit',
          label: '访问',
          onClick: () => window.open(cmsPreviewUrl(record.code), '_blank'),
        },
        ...(hasPermission('cms:static:build') ? [{
          key: 'static',
          label: '静态化',
          onClick: () => setStaticSheetSite(record),
        }] : []),
        ...(hasPermission('cms:site:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(record),
        }, {
          key: 'users',
          label: '授权用户',
          onClick: () => openUsersModal(record),
        }, {
          key: 'export',
          label: '导出',
          onClick: () => handleExport(record),
        }, {
          key: 'analytics',
          label: (record.settings as Record<string, unknown>)?.analyticsSiteKey ? '统计已开通' : '开通统计',
          onClick: () => {
            if ((record.settings as Record<string, unknown>)?.analyticsSiteKey) {
              Toast.info('该站点已开通行为统计，数据见「数据分析 → 行为分析」');
              return;
            }
            Modal.confirm({
              title: `为「${record.name}」开通行为统计？`,
              content: '将自动创建统计站点并在前台页面注入采集脚本（需重新生成静态页生效）',
              onOk: async () => {
                await enableAnalyticsMutation.mutateAsync(record.id);
                Toast.success('已开通，重新生成静态页后生效');
              },
            });
          },
        }] : []),
        ...(hasPermission('cms:site:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该站点吗？',
              content: '需先清空站点下的栏目与内容',
              onOk: () => handleDelete(record.id),
            });
          },
        }] : []),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索名称/标识/域名..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      showClear
      style={{ width: 220 }}
      onEnterPress={handleSearch}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={draftParams.status || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  );
  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  );
  const renderCreateButton = () => hasPermission('cms:site:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;
  const renderImportButton = () => hasPermission('cms:site:create') ? (
    <Button icon={<UploadIcon size={14} />} loading={importMutation.isPending} onClick={() => importFileRef.current?.click()}>导入</Button>
  ) : null;

  const listTplOptions = (themeTemplates?.list ?? []).map((t) => ({ value: t.name, label: t.label }));
  const detailTplOptions = (themeTemplates?.detail ?? []).map((t) => ({ value: t.name, label: t.label }));

  // 栏目/内容级失效引用（站点级由本地自动清理负责；这两级存在其他表，仅提示不阻断保存）
  const externalInvalidRefs = (templateHealth?.invalidRefs ?? []).filter((r) => r.source !== 'site');

  // 模板页签的通道来源：编辑时取站点通道（启用的）；新建站点尚无通道记录，回退虚拟默认通道
  const templateChannelTabs: { code: string; name: string }[] = (() => {
    const enabled = (sitePublishChannels ?? []).filter((ch) => ch.status === 'enabled');
    if (enabled.length > 0) return enabled.map((ch) => ({ code: ch.code, name: ch.name }));
    return [{ code: CMS_DEFAULT_CHANNEL_CODE, name: 'PC 桌面' }];
  })();

  /** 单个发布通道的默认模板配置面板（动态字段名不走 Form，受控 state 管理） */
  const renderChannelTemplates = (channel: { code: string; name: string }) => {
    const cfg = templateDefaults[channel.code] ?? EMPTY_CHANNEL_CONFIG;
    const patch = (p: Partial<ChannelTemplateConfig>) =>
      setTemplateDefaults((s) => ({ ...s, [channel.code]: { ...(s[channel.code] ?? EMPTY_CHANNEL_CONFIG), ...p } }));
    const rowStyle = { display: 'flex', alignItems: 'center', gap: 12 } as const;
    const labelStyle = { width: 140, flexShrink: 0, textAlign: 'right', fontSize: 14, color: 'var(--semi-color-text-0)' } as const;
    return (
      <TabPane tab={channel.name} itemKey={channel.code} key={channel.code}>
        <div style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={rowStyle}>
            <span style={labelStyle}>栏目列表页模板</span>
            <Select
              placeholder="跟随主题默认"
              value={cfg.list ?? undefined}
              onChange={(v) => patch({ list: (v as string) ?? null })}
              showClear
              style={{ width: 320 }}
              optionList={listTplOptions}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>内容详情页模板</span>
            <Select
              placeholder="跟随主题默认"
              value={cfg.detail ?? undefined}
              onChange={(v) => patch({ detail: (v as string) ?? null })}
              showClear
              style={{ width: 320 }}
              optionList={detailTplOptions}
            />
          </div>
          {(allModels ?? []).map((m) => (
            <div style={rowStyle} key={m.id}>
              <span style={labelStyle}>{m.name}详情模板</span>
              <Select
                placeholder="跟随详情页默认"
                value={cfg.detailByModel[m.code] ?? undefined}
                onChange={(v) => patch({ detailByModel: { ...cfg.detailByModel, [m.code]: (v as string) ?? null } })}
                showClear
                style={{ width: 320 }}
                optionList={detailTplOptions}
              />
            </div>
          ))}
        </div>
      </TabPane>
    );
  };

  // ─── 主题参数动态表单（settingsSchema 驱动，值存 settings.themeConfig）────────
  const themeConfigPatch = (name: string, value: unknown) =>
    setThemeConfig((c) => ({ ...c, [name]: value }));

  const renderThemeSettingControl = (field: CmsThemeSettingField) => {
    const value = themeConfig[field.name];
    switch (field.fieldType) {
      case 'switch':
        return (
          <Switch
            checked={typeof value === 'boolean' ? value : field.defaultValue === true}
            onChange={(v) => themeConfigPatch(field.name, v)}
          />
        );
      case 'number':
        return (
          <InputNumber
            value={typeof value === 'number' ? value : undefined}
            placeholder={field.placeholder ?? (field.defaultValue !== undefined ? `默认 ${field.defaultValue}` : undefined)}
            onChange={(v) => themeConfigPatch(field.name, typeof v === 'number' ? v : undefined)}
            style={{ width: 320 }}
          />
        );
      case 'select':
        return (
          <Select
            value={typeof value === 'string' ? value : undefined}
            placeholder={field.placeholder ?? '请选择'}
            showClear
            onChange={(v) => themeConfigPatch(field.name, v ?? undefined)}
            optionList={(field.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
            style={{ width: 320 }}
          />
        );
      case 'textarea':
        return (
          <TextArea
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder}
            rows={3}
            onChange={(v) => themeConfigPatch(field.name, v)}
            style={{ width: 480, maxWidth: '100%' }}
          />
        );
      case 'color': {
        const text = typeof value === 'string' ? value : '';
        const swatch = /^#[0-9a-fA-F]{3,8}$/.test(text) ? text : '#1f6feb';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Input
              value={text}
              placeholder={field.placeholder ?? '如 #1f6feb'}
              showClear
              onChange={(v) => themeConfigPatch(field.name, v)}
              style={{ width: 240 }}
            />
            <input
              type="color"
              value={swatch}
              onChange={(e) => themeConfigPatch(field.name, e.target.value)}
              style={{ width: 32, height: 32, padding: 0, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', cursor: 'pointer', background: 'transparent' }}
              aria-label={`${field.label}取色`}
            />
          </div>
        );
      }
      case 'image': {
        const url = typeof value === 'string' ? value : '';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 480, maxWidth: '100%' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={url}
                placeholder={field.placeholder ?? '图片 URL，或点击上传'}
                showClear
                onChange={(v) => themeConfigPatch(field.name, v)}
                style={{ flex: 1 }}
              />
              <Upload
                action=""
                accept="image/*"
                showUploadList={false}
                disabled={!editingRecord}
                customRequest={async ({ fileInstance, onSuccess, onError }) => {
                  if (!editingRecord) { onError?.({ status: 0 }); return; }
                  try {
                    const formData = new FormData();
                    formData.append('file', fileInstance);
                    const res = await request.postForm<{ url: string }>(
                      `/api/cms/upload-image?siteId=${editingRecord.id}`, formData,
                    ).then(unwrap);
                    themeConfigPatch(field.name, res.url);
                    onSuccess?.({});
                  } catch {
                    onError?.({ status: 0 });
                  }
                }}
              >
                <Button icon={<ImageUp size={14} />} disabled={!editingRecord}
                  title={editingRecord ? undefined : '保存站点后可上传，也可直接粘贴 URL'}>上传</Button>
              </Upload>
            </div>
            {url ? <img src={url} alt={field.label} style={{ maxWidth: 320, maxHeight: 120, borderRadius: 'var(--semi-border-radius-medium)', objectFit: 'cover', border: '1px solid var(--semi-color-border)' }} /> : null}
          </div>
        );
      }
      default:
        return (
          <Input
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder}
            showClear
            onChange={(v) => themeConfigPatch(field.name, v)}
            style={{ width: 320 }}
          />
        );
    }
  };

  /** 主题参数按 group 分组渲染（无 schema 的主题不显示该区域） */
  const renderThemeSettingsSections = () => {
    const schema = themeSettingsSchema ?? [];
    if (schema.length === 0) return null;
    const groups = new Map<string, CmsThemeSettingField[]>();
    for (const field of schema) {
      const key = field.group ?? '通用';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(field);
    }
    const rowStyle = { display: 'flex', alignItems: 'flex-start', gap: 12 } as const;
    const labelStyle = { width: 140, flexShrink: 0, textAlign: 'right', fontSize: 14, color: 'var(--semi-color-text-0)', lineHeight: '32px' } as const;
    return [...groups.entries()].map(([group, fields]) => (
      <Form.Section key={group} text={`主题专属参数 — ${group}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
          {fields.map((field) => (
            <div style={rowStyle} key={field.name}>
              <span style={labelStyle}>{field.label}</span>
              <div style={{ flex: 1 }}>
                {renderThemeSettingControl(field)}
                {field.description ? (
                  <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginTop: 4 }}>{field.description}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Form.Section>
    ));
  };

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        actions={(
          <>
            {renderImportButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={renderStatusFilter()}
        filterTitle="筛选条件"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无站点"
        scroll={{ x: 1400 }}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />

      <SideSheet
        title={editingRecord ? '编辑站点' : '新增站点'}
        visible={modalVisible}
        onCancel={closeModal}
        width={720}
        closeOnEsc
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="tertiary" onClick={closeModal}>取消</Button>
            <Button type="primary" theme="solid" loading={saveMutation.isPending} onClick={() => void handleSave()}>保存</Button>
          </div>
        )}
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={100}
          onValueChange={(vals) => {
            const t = (vals as { theme?: string }).theme;
            if (t && t !== selectedTheme) setSelectedTheme(t);
          }}
        >
          {/* keepDOM（默认）保证非激活页字段仍挂载，切换标签不丢值、validate 全量生效 */}
          <Tabs type="line" activeKey={activeTab} onChange={setActiveTab}>
            <TabPane tab="基础信息" itemKey="basic">
              <Row gutter={16} style={{ paddingTop: 16 }}>
                <Col span={12}>
                  <Form.Input field="name" label="站点名称" rules={[{ required: true, message: '请输入站点名称' }]} />
                </Col>
                <Col span={12}>
                  <Form.Input field="code" label="站点标识" disabled={!!editingRecord} placeholder="小写字母/数字/中划线" rules={[{ required: true, message: '请输入站点标识' }]} />
                </Col>
                <Col span={12}>
                  <Form.Input field="domain" label="绑定域名" placeholder="如 www.example.com" />
                </Col>
                <Col span={12}>
                  <Form.TagInput field="aliasDomains" label="别名域名" placeholder="回车添加" />
                </Col>
                <Col span={12}>
                  <Form.Select field="theme" label="主题" style={{ width: '100%' }}
                    optionList={(themes ?? []).map((t) => ({ value: t.code, label: t.label }))} />
                </Col>
                <Col span={12}>
                  <Form.Select field="staticMode" label="静态化模式" style={{ width: '100%' }}
                    optionList={CMS_STATIC_MODES.map((m) => ({ value: m, label: CMS_STATIC_MODE_LABELS[m] }))} />
                </Col>
                <Col span={12}>
                  <Form.Switch field="isDefault" label="默认站点" extraText="未匹配到域名的请求兜底到默认站点" />
                </Col>
                <Col span={12}>
                  <Form.RadioGroup field="status" label="状态">
                    <Form.Radio value="enabled">启用</Form.Radio>
                    <Form.Radio value="disabled">停用</Form.Radio>
                  </Form.RadioGroup>
                </Col>
              </Row>
            </TabPane>
            <TabPane tab="SEO 与推送" itemKey="seo">
              <div style={{ paddingTop: 16 }}>
                <Form.Input field="title" label="SEO 标题" labelWidth={140} placeholder="站点默认 title" />
                <Form.Input field="keywords" label="SEO 关键词" labelWidth={140} placeholder="逗号分隔" />
                <Form.TextArea field="description" label="SEO 描述" labelWidth={140} rows={2} />
                <Form.TextArea field="robots" label="robots.txt" labelWidth={140} rows={3} placeholder="留空使用默认规则（Allow all + Sitemap）" />
                <Form.Section text="搜索推送（配置后发布内容自动推送搜索引擎）">
                  <Form.Input field="baiduPushToken" label="百度推送 Token" labelWidth={140} placeholder="百度搜索资源平台 → 普通收录" />
                  <Form.Input field="indexNowKey" label="IndexNow Key" labelWidth={140} placeholder="Bing 等引擎；key 文件自动托管" />
                </Form.Section>
              </div>
            </TabPane>
            <TabPane tab="审核与 Webhook" itemKey="integration">
              <div style={{ paddingTop: 16 }}>
                <Form.Section text="内容审核">
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Select field="auditMode" label="审核方式" style={{ width: '100%' }}
                        optionList={[
                          { value: 'simple', label: '简单审核（审核 Tab 通过/驳回）' },
                          { value: 'workflow', label: '工作流审核（提交后走审批流程）' },
                        ]} />
                    </Col>
                    <Col span={12}>
                      <Form.Select field="auditWorkflowDefinitionId" label="审核流程" style={{ width: '100%' }} showClear
                        placeholder="留空使用「CMS 内容审核」流程"
                        optionList={(publishedDefs ?? []).map((d) => ({ value: d.id, label: d.name }))} />
                    </Col>
                  </Row>
                </Form.Section>
                <Form.Section text="Webhook（内容发布/下线/回收时向外部系统推送事件）">
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Input field="webhookUrl" label="回调地址" placeholder="https://... 留空不推送" />
                    </Col>
                    <Col span={12}>
                      <Form.Input field="webhookSecret" label="签名密钥" placeholder="可选；请求头 X-Cms-Signature 携带 HMAC-SHA256 签名" />
                    </Col>
                  </Row>
                </Form.Section>
                <Form.Section text="前台防护">
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Switch field="captchaEnabled" label="图形验证码" extraText="开启后前台游客提交评论/自定义表单需完成算术验证码（登录会员免验证）" />
                    </Col>
                  </Row>
                </Form.Section>
                <Form.Section text="CDN 刷新（静态页更新后向 purge webhook 推送变更路径）">
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Input field="cdnPurgeUrl" label="刷新回调地址" placeholder="https://... 留空不启用" />
                    </Col>
                    <Col span={12}>
                      <Form.Input field="cdnPurgeToken" label="鉴权令牌" placeholder="可选；Authorization: Bearer 携带" />
                    </Col>
                  </Row>
                </Form.Section>
                <Form.Section text="多语言站点关联（前台输出 hreflang 与语言切换）">
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Input field="language" label="本站语言" placeholder="如 zh-CN；留空不启用" />
                    </Col>
                    <Col span={12}>
                      <Form.TextArea field="langLinksText" label="关联站点" rows={3}
                        placeholder={'每行一条：语言代码=站点标识\n如 en-US=en-site'} />
                    </Col>
                  </Row>
                </Form.Section>
              </div>
            </TabPane>
            <TabPane tab="主题与图片" itemKey="appearance">
              <div style={{ paddingTop: 16 }}>
                <Form.Section text="主题参数">
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Input field="themePrimary" label="主题色" labelWidth={140} placeholder="如 #1f6feb，留空用主题默认" />
                    </Col>
                    <Col span={12}>
                      <Form.Select field="themeDark" label="暗色模式" labelWidth={140} style={{ width: '100%' }}
                        optionList={[
                          { value: 'light', label: '仅浅色' },
                          { value: 'auto', label: '跟随系统（带切换按钮）' },
                          { value: 'dark', label: '支持切换（带切换按钮）' },
                        ]} />
                    </Col>
                  </Row>
                </Form.Section>
                {renderThemeSettingsSections()}
                <Form.Section text="图片处理（编辑器/封面上传时生效）">
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.InputNumber field="imageMaxWidth" label="最大宽度(px)" labelWidth={140} min={0} style={{ width: '100%' }} extraText="超宽等比压缩，0 = 不限制" />
                    </Col>
                    <Col span={12}>
                      <Form.Switch field="thumbEnabled" label="生成缩略图" labelWidth={140} />
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.InputNumber field="thumbWidth" label="缩略图宽度(px)" labelWidth={140} min={0} style={{ width: '100%' }} extraText="开启缩略图后生效" />
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Switch field="watermarkEnabled" label="文字水印" labelWidth={140} />
                    </Col>
                    <Col span={12}>
                      <Form.Input field="watermarkText" label="水印文字" labelWidth={140} placeholder="如站点名称" />
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Select field="watermarkPosition" label="水印位置" labelWidth={140} style={{ width: '100%' }}
                        optionList={[
                          { value: 'northwest', label: '左上' }, { value: 'north', label: '上中' }, { value: 'northeast', label: '右上' },
                          { value: 'west', label: '左中' }, { value: 'center', label: '居中' }, { value: 'east', label: '右中' },
                          { value: 'southwest', label: '左下' }, { value: 'south', label: '下中' }, { value: 'southeast', label: '右下' },
                        ]} />
                    </Col>
                    <Col span={12}>
                      <Form.InputNumber field="watermarkOpacity" label="水印不透明度(%)" labelWidth={140} min={0} max={100} style={{ width: '100%' }} />
                    </Col>
                  </Row>
                </Form.Section>
              </div>
            </TabPane>
            <TabPane tab="模板与通道" itemKey="templates">
              <div style={{ paddingTop: 16 }}>
                {externalInvalidRefs.length > 0 && (
                  <Banner
                    type="warning"
                    closeIcon={null}
                    style={{ marginBottom: 16 }}
                    description={(
                      <div>
                        主题「{selectedTheme}」下存在 {externalInvalidRefs.length} 处失效模板引用，前台渲染时将回退主题默认模板：
                        <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                          {externalInvalidRefs.slice(0, 8).map((ref, i) => (
                            <li key={i}>{describeInvalidRef(ref)}</li>
                          ))}
                          {externalInvalidRefs.length > 8 && <li>等共 {externalInvalidRefs.length} 处…</li>}
                        </ul>
                        请到栏目管理 / 内容编辑中调整对应模板配置。
                      </div>
                    )}
                  />
                )}
                <div style={{ marginBottom: 16, color: 'var(--semi-color-text-2)', fontSize: 13 }}>
                  发布通道（PC/H5/小程序等输出端）在「CMS 内容管理 → 发布通道」页面按站点自由创建，
                  每个通道可独立绑定域名与 UA 跳转规则；此处按通道配置站点级默认模板。
                </div>
                <Form.Section text="默认模板（栏目/内容未指定模板时的站点级兜底；留空 = 主题默认）">
                  <Tabs type="card" size="small">
                    {templateChannelTabs.map((channel) => renderChannelTemplates(channel))}
                  </Tabs>
                </Form.Section>
              </div>
            </TabPane>
            <TabPane tab="备案与备注" itemKey="misc">
              <div style={{ paddingTop: 16 }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Input field="icp" label="ICP 备案号" />
                  </Col>
                  <Col span={12}>
                    <Form.Input field="copyright" label="版权信息" />
                  </Col>
                </Row>
                <Form.Input field="remark" label="备注" />
              </div>
            </TabPane>
          </Tabs>
        </Form>
      </SideSheet>

      {/* 站点导入：隐藏文件选择器（读取导出包 JSON 后提交） */}
      <input type="file" accept=".json,application/json" hidden ref={importFileRef} onChange={(e) => void handleImportFile(e)} />

      {/* 授权用户弹窗（站点级数据权限） */}
      <AppModal
        title={usersModalSite ? `「${usersModalSite.name}」授权用户` : '授权用户'}
        visible={!!usersModalSite}
        onOk={handleUsersModalOk}
        onCancel={() => setUsersModalSite(null)}
        okButtonProps={{ loading: setSiteUsersMutation.isPending, disabled: siteUsersQuery.isFetching }}
        width={520}
        closeOnEsc
      >
        <div style={{ marginBottom: 12, color: 'var(--semi-color-text-2)', fontSize: 13 }}>
          绑定用户后，仅超管与授权用户可管理该站点；不绑定任何用户则全员（有 CMS 权限者）可管理。
        </div>
        <Select
          multiple
          filter
          placeholder="选择授权用户"
          value={selectedUserIds}
          onChange={(v) => setSelectedUserIds((v as number[]) ?? [])}
          style={{ width: '100%' }}
          loading={siteUsersQuery.isFetching}
          optionList={(allUsers ?? []).map((u) => ({ value: u.id, label: `${u.nickname}（${u.username}）` }))}
        />
      </AppModal>

      {/* 静态化面板（原「静态化管理」独立页面整合至此） */}
      <SideSheet
        title={staticSheetSite ? `静态化 —「${staticSheetSite.name}」` : '静态化'}
        visible={!!staticSheetSite}
        onCancel={() => setStaticSheetSite(null)}
        width={820}
        closeOnEsc
      >
        {staticSheetSite ? (
          <div style={{ paddingTop: 8 }}>
            <SiteStaticPanel site={staticSheetSite} canBuild={hasPermission('cms:static:build')} />
          </div>
        ) : null}
      </SideSheet>
    </div>
  );
}
