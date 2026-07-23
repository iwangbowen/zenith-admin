import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Banner,
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  SideSheet,
  Space,
  TabPane,
  Tabs,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { FileCheck2, Plus, RotateCcw, Search, Upload } from 'lucide-react';
import {
  CMS_TEMPLATE_SOURCE_LABELS,
  CMS_TEMPLATE_TYPE_LABELS,
  CMS_TEMPLATE_TYPES,
  CMS_THEME_PACKAGE_STATUS_LABELS,
  type CmsTemplate,
  type CmsTemplateDslDocument,
  type CmsTemplateValidationReport,
  type CmsTemplateVersion,
  type CmsThemePackage,
  type CmsThemePackageValidationReport,
} from '@zenith/shared';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import AppModal from '@/components/AppModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useAllCmsSites } from '@/hooks/queries/cms';
import {
  cmsTemplateKeys,
  cmsThemePackageKeys,
  useActivateCmsThemePackage,
  useActivateBuiltinCmsTheme,
  useCmsTemplateAction,
  useCmsTemplateDetail,
  useCmsTemplateDiff,
  useCmsTemplateList,
  useCmsThemeImpact,
  useCmsThemePackageList,
  useCmsThemeSiteAction,
  useCreateCmsTemplate,
  useImportCmsThemePackage,
  usePreviewCmsTemplate,
  usePreviewCmsThemePackage,
  useSaveCmsTemplateVersion,
  useSetCmsThemePackageStatus,
  useValidateCmsTemplate,
  useValidateCmsThemePackage,
} from '@/hooks/queries/cms-stage3';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';

type TabKey = 'templates' | 'packages';

const EMPTY_DSL: CmsTemplateDslDocument = {
  version: 1,
  root: {
    kind: 'element',
    tag: 'html',
    attrs: { lang: 'zh-CN' },
    children: [
      { kind: 'element', tag: 'head', children: [{ kind: 'component', name: 'seo_head' }] },
      {
        kind: 'element',
        tag: 'body',
        children: [
          { kind: 'component', name: 'site_header' },
          { kind: 'element', tag: 'main', children: [{ kind: 'text', value: '声明式模板内容' }] },
          { kind: 'component', name: 'site_footer' },
        ],
      },
    ],
  },
};

function parseDsl(text: string): CmsTemplateDslDocument | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' ? value as CmsTemplateDslDocument : null;
  } catch {
    return null;
  }
}

function ValidationBanner({ report }: { report: CmsTemplateValidationReport | null }) {
  if (!report) return <Banner type="info" description="保存前请先执行 Schema 校验；服务端同时执行白名单、深度、节点数与字符串长度检查。" />;
  return report.valid ? (
    <Banner type="success" description={`校验通过 · ${report.nodeCount} 节点 · 最大深度 ${report.maxDepth} · SHA-256 ${report.checksum}`} />
  ) : (
    <Banner
      type="danger"
      description={report.issues.slice(0, 5).map((item) => `${item.path}: ${item.message}`).join('；')}
    />
  );
}

export default function ThemesPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const sitesQuery = useAllCmsSites();
  const sites = sitesQuery.data ?? [];
  const siteOptions = sites.map((site) => ({ value: site.id, label: site.name }));
  const [activeTab, setActiveTab] = useState<TabKey>('templates');

  const templatePagination = usePagination();
  const [templateDraft, setTemplateDraft] = useState({ keyword: '', type: '', status: '', siteId: undefined as number | undefined });
  const [templateSubmitted, setTemplateSubmitted] = useState(templateDraft);
  const templateListQuery = useCmsTemplateList({
    page: templatePagination.page,
    pageSize: templatePagination.pageSize,
    keyword: templateSubmitted.keyword || undefined,
    type: templateSubmitted.type as CmsTemplate['type'] || undefined,
    status: templateSubmitted.status || undefined,
    siteId: templateSubmitted.siteId,
  });
  const templates = templateListQuery.data?.list ?? [];

  const packagePagination = usePagination();
  const [packageDraft, setPackageDraft] = useState({ keyword: '', status: '' });
  const [packageSubmitted, setPackageSubmitted] = useState(packageDraft);
  const packageListQuery = useCmsThemePackageList({
    page: packagePagination.page,
    pageSize: packagePagination.pageSize,
    keyword: packageSubmitted.keyword || undefined,
    status: packageSubmitted.status || undefined,
  });
  const packages = packageListQuery.data?.list ?? [];

  const [templateModal, setTemplateModal] = useState<{ record: CmsTemplate | null } | null>(null);
  const [templateForm, setTemplateForm] = useState({
    siteId: undefined as number | undefined,
    themeCode: 'default',
    type: 'list' as CmsTemplate['type'],
    code: '',
    name: '',
    description: '',
    changeNote: '',
  });
  const [dslText, setDslText] = useState(JSON.stringify(EMPTY_DSL, null, 2));
  const [dslReport, setDslReport] = useState<CmsTemplateValidationReport | null>(null);
  const detailQuery = useCmsTemplateDetail(templateModal?.record?.id, templateModal?.record != null);
  const validateTemplate = useValidateCmsTemplate();
  const createTemplate = useCreateCmsTemplate();
  const saveVersion = useSaveCmsTemplateVersion();
  const activateTemplate = useCmsTemplateAction('activate');
  const deactivateTemplate = useCmsTemplateAction('deactivate');
  const rollbackTemplate = useCmsTemplateAction('rollback');
  const diffTemplate = useCmsTemplateDiff();
  const previewTemplate = usePreviewCmsTemplate();
  const [versionsTemplate, setVersionsTemplate] = useState<CmsTemplate | null>(null);
  const versionsQuery = useCmsTemplateDetail(versionsTemplate?.id, versionsTemplate != null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!templateModal?.record || !detailQuery.data) return;
    const record = detailQuery.data;
    const latest = record.versions.find((version) => version.version === record.currentVersion) ?? record.versions[0];
    setTemplateForm({
      siteId: record.siteId ?? undefined,
      themeCode: record.themeCode,
      type: record.type,
      code: record.code,
      name: record.name,
      description: record.description ?? '',
      changeNote: '',
    });
    if (latest) setDslText(JSON.stringify(latest.dsl, null, 2));
    setDslReport(null);
  }, [detailQuery.data, templateModal?.record]);

  const openCreateTemplate = () => {
    setTemplateModal({ record: null });
    setTemplateForm({ siteId: sites[0]?.id, themeCode: 'default', type: 'list', code: '', name: '', description: '', changeNote: '' });
    setDslText(JSON.stringify(EMPTY_DSL, null, 2));
    setDslReport(null);
  };

  const validateDsl = async () => {
    const dsl = parseDsl(dslText);
    if (!dsl) {
      setDslReport({ valid: false, version: null, checksum: null, nodeCount: 0, maxDepth: 0, issues: [{ path: '$', code: 'invalid_json', message: '不是有效 JSON' }] });
      return null;
    }
    const report = await validateTemplate.mutateAsync(dsl);
    setDslReport(report);
    return report.valid ? dsl : null;
  };

  const saveTemplate = async () => {
    const dsl = await validateDsl();
    if (!dsl) return;
    if (templateModal?.record) {
      await saveVersion.mutateAsync({ id: templateModal.record.id, dsl, changeNote: templateForm.changeNote || undefined });
      Toast.success('新版本已保存，需手动激活后影响正式发布');
    } else {
      if (!templateForm.code || !templateForm.name) {
        Toast.warning('请填写模板编码和名称');
        return;
      }
      await createTemplate.mutateAsync({
        ...templateForm,
        siteId: templateForm.siteId ?? null,
        description: templateForm.description || null,
        changeNote: templateForm.changeNote || null,
        dsl,
      });
      Toast.success('模板已创建');
    }
    setTemplateModal(null);
  };

  const runTemplatePreview = async (record: CmsTemplate, version?: number) => {
    const siteId = record.siteId ?? sites[0]?.id;
    if (!siteId) return Toast.warning('没有可用于预览的站点');
    const pathByType: Partial<Record<CmsTemplate['type'], string>> = {
      index: '',
      list: 'news/',
      detail: 'news/1.html',
      page: 'about/',
      search: 'search',
      tag: 'tag/industry/',
      not_found: 'not-existing-page',
      custom_page: 'p/capabilities/',
      survey: 'survey/satisfaction/',
    };
    const path = pathByType[record.type];
    if (path === undefined) return Toast.warning(`${CMS_TEMPLATE_TYPE_LABELS[record.type]}没有独立页面上下文，请从引用页面预览`);
    const result = await previewTemplate.mutateAsync({ id: record.id, siteId, path, version });
    setPreviewHtml(result.html);
  };

  const showDiff = async (record: CmsTemplate, version: CmsTemplateVersion) => {
    if (version.version === record.currentVersion) return Toast.info('该版本已是当前版本');
    const result = await diffTemplate.mutateAsync({ id: record.id, from: version.version, to: record.currentVersion });
    Modal.info({
      title: `v${version.version} → v${record.currentVersion} 结构化差异`,
      content: <pre style={{ maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(result.changes, null, 2)}</pre>,
      okText: '关闭',
    });
  };

  const templateColumns: ColumnProps<CmsTemplate>[] = [
    { title: '名称', dataIndex: 'name', width: 180, render: renderEllipsis },
    { title: '编码', dataIndex: 'code', width: 150 },
    { title: '主题', dataIndex: 'themeCode', width: 120 },
    { title: '类型', dataIndex: 'type', width: 110, render: (value: CmsTemplate['type']) => CMS_TEMPLATE_TYPE_LABELS[value] },
    { title: '来源', dataIndex: 'source', width: 110, render: (value: CmsTemplate['source']) => CMS_TEMPLATE_SOURCE_LABELS[value] },
    { title: '版本', width: 150, render: (_: unknown, record) => record.source === 'package' ? `v${record.currentVersion} / 部署派生` : `v${record.currentVersion} / ${record.activeVersion ? `v${record.activeVersion}` : '未激活'}` },
    { title: '更新时间', dataIndex: 'updatedAt', width: 180, render: (value: string) => formatDateTime(value) },
    {
      title: '状态', dataIndex: 'status', width: 100, fixed: 'right',
      render: (value: CmsTemplate['status'], record) => record.source === 'package'
        ? <Tag color="blue">主题部署派生</Tag>
        : <Tag color={value === 'enabled' ? 'green' : 'grey'}>{value === 'enabled' ? '启用' : '停用'}</Tag>,
    },
    createOperationColumn<CmsTemplate>({
      width: 230,
      desktopInlineKeys: ['preview', 'versions'],
      actions: (record) => [
        { key: 'preview', label: '预览', onClick: async () => { await runTemplatePreview(record); }, hidden: record.source === 'package' },
        { key: 'versions', label: '版本', onClick: () => setVersionsTemplate(record) },
        {
          key: 'edit', label: record.source === 'package' ? '不可编辑' : '新版本',
          onClick: () => setTemplateModal({ record }),
          disabled: record.source === 'package' || !hasPermission('cms:template:manage'),
          disabledReason: record.source === 'package' ? '主题包模板只能通过导入新包升级' : '缺少模板管理权限',
        },
        {
          key: 'activate', label: '激活当前版本',
          onClick: async () => { await activateTemplate.mutateAsync({ id: record.id }); Toast.success('模板已激活，重建任务已提交'); },
          disabled: !hasPermission('cms:template:activate') || record.activeVersion === record.currentVersion,
          disabledReason: record.activeVersion === record.currentVersion ? '当前版本已激活' : '缺少激活权限',
          hidden: record.source === 'package',
        },
        {
          key: 'deactivate', label: '停用', danger: true,
          onClick: async () => { await deactivateTemplate.mutateAsync({ id: record.id }); Toast.success('模板已停用'); },
          disabled: !hasPermission('cms:template:activate') || record.activeVersion == null,
          disabledReason: record.activeVersion == null ? '模板未激活' : '缺少激活权限',
          hidden: record.source === 'package',
        },
      ],
    }),
  ];

  const uploadInput = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [packageReport, setPackageReport] = useState<CmsThemePackageValidationReport | null>(null);
  const [uploadVisible, setUploadVisible] = useState(false);
  const validatePackage = useValidateCmsThemePackage();
  const importPackage = useImportCmsThemePackage();
  const { tasks: importTasks } = useMyAsyncTasks({ taskTypes: ['cms-theme-import'], pageSize: 50 });
  const [importTaskId, setImportTaskId] = useState<number | null>(null);
  const handledImportTasks = useRef(new Set<number>());
  const importTask = importTasks.find((task) => task.id === importTaskId) ?? null;
  const activatePackage = useActivateCmsThemePackage();
  const activateBuiltin = useActivateBuiltinCmsTheme();
  const rollbackPackage = useCmsThemeSiteAction('rollback');
  const deactivatePackage = useCmsThemeSiteAction('deactivate');
  const setPackageStatus = useSetCmsThemePackageStatus();
  const previewPackage = usePreviewCmsThemePackage();
  const [packageAction, setPackageAction] = useState<CmsThemePackage | null>(null);
  const [packageSiteId, setPackageSiteId] = useState<number | undefined>(undefined);
  const [builtinAction, setBuiltinAction] = useState<'default' | 'docs' | null>(null);
  const [builtinSiteId, setBuiltinSiteId] = useState<number | undefined>(undefined);
  const [siteLifecycleAction, setSiteLifecycleAction] = useState<{ record: CmsThemePackage; action: 'rollback' | 'deactivate' } | null>(null);
  const [lifecycleSiteId, setLifecycleSiteId] = useState<number | undefined>(undefined);
  const [impactTarget, setImpactTarget] = useState<{ siteId: number; code: string; packageId: number } | null>(null);
  const impactQuery = useCmsThemeImpact(impactTarget?.siteId, impactTarget?.code, impactTarget?.packageId, impactTarget != null);

  useEffect(() => {
    if (!importTask || !['success', 'failed', 'cancelled'].includes(importTask.status) || handledImportTasks.current.has(importTask.id)) return;
    handledImportTasks.current.add(importTask.id);
    void queryClient.invalidateQueries({ queryKey: cmsThemePackageKeys.all });
    void queryClient.invalidateQueries({ queryKey: cmsTemplateKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['cms-sites'] });
    if (importTask.status === 'success') Toast.success(`主题包导入任务 #${importTask.id} 已完成`);
    else Toast.error(`主题包导入任务 #${importTask.id} ${importTask.status === 'failed' ? `失败：${importTask.errorMessage ?? '请查看任务明细'}` : '已取消'}`);
  }, [importTask, queryClient]);

  const choosePackage = async (file: File | undefined) => {
    if (!file) return;
    setUploadFile(file);
    setPackageReport(null);
    const report = await validatePackage.mutateAsync(file);
    setPackageReport(report);
  };

  const importValidatedPackage = async () => {
    if (!uploadFile || !packageReport?.valid) return;
    const task = await importPackage.mutateAsync(uploadFile);
    setImportTaskId(task.id);
    Toast.success(`导入任务 #${task.id} 已提交，可在任务中心查看进度`);
    setUploadVisible(false);
  };

  const activateSelectedPackage = async () => {
    if (!packageAction || !packageSiteId) return;
    const result = await activatePackage.mutateAsync({ id: packageAction.id, siteId: packageSiteId });
    Toast.success(`${result.siteName} 已激活主题，重建任务 #${result.task.id} 已提交`);
    setPackageAction(null);
  };

  const previewSelectedPackage = async (record: CmsThemePackage) => {
    const siteId = record.activeSiteIds[0] ?? sites[0]?.id;
    if (!siteId) return Toast.warning('没有可用于预览的站点');
    const result = await previewPackage.mutateAsync({ id: record.id, siteId, path: '' });
    setPreviewHtml(result.html);
  };

  const runSiteLifecycleAction = async () => {
    if (!siteLifecycleAction || !lifecycleSiteId) return;
    const mutation = siteLifecycleAction.action === 'rollback' ? rollbackPackage : deactivatePackage;
    await mutation.mutateAsync({ siteId: lifecycleSiteId, themeCode: siteLifecycleAction.record.code, packageId: siteLifecycleAction.record.id });
    Toast.success(siteLifecycleAction.action === 'rollback' ? '已回滚到上一主题包版本' : '站点已回退内置 default 主题');
    setSiteLifecycleAction(null);
  };

  const activateSelectedBuiltin = async () => {
    if (!builtinAction || !builtinSiteId) return;
    const result = await activateBuiltin.mutateAsync({ code: builtinAction, siteId: builtinSiteId });
    Toast.success(`${result.siteName} 已激活内置主题 ${result.themeCode}，重建任务 #${result.task.id} 已提交`);
    setBuiltinAction(null);
  };

  const packageColumns: ColumnProps<CmsThemePackage>[] = [
    { title: '主题', dataIndex: 'name', width: 180, render: renderEllipsis },
    { title: '编码', dataIndex: 'code', width: 150 },
    { title: '版本', dataIndex: 'version', width: 100 },
    { title: '引擎', width: 100, render: (_: unknown, record) => `${record.engineMin}-${record.engineMax}` },
    { title: '签名 Key', dataIndex: 'signingKeyId', width: 150 },
    { title: '生效站点', width: 100, render: (_: unknown, record) => record.activeSiteIds.length },
    { title: '导入时间', dataIndex: 'createdAt', width: 180, render: (value: string) => formatDateTime(value) },
    {
      title: '状态', dataIndex: 'status', width: 110, fixed: 'right',
      render: (value: CmsThemePackage['status']) => <Tag color={value === 'validated' ? 'green' : 'grey'}>{CMS_THEME_PACKAGE_STATUS_LABELS[value]}</Tag>,
    },
    createOperationColumn<CmsThemePackage>({
      width: 230,
      desktopInlineKeys: ['preview', 'activate'],
      actions: (record) => [
        {
          key: 'preview', label: '预览', onClick: () => previewSelectedPackage(record),
          disabled: record.status !== 'validated', disabledReason: record.validationReport.issues[0]?.message ?? '主题包未通过校验',
        },
        {
          key: 'activate', label: '激活', onClick: () => { setPackageAction(record); setPackageSiteId(record.activeSiteIds[0] ?? sites[0]?.id); },
          disabled: record.status !== 'validated' || !hasPermission('cms:theme:activate'),
          disabledReason: record.status !== 'validated' ? '主题包未通过可信签名校验' : '缺少激活权限',
        },
        {
          key: 'impact', label: '影响分析', onClick: () => {
            const siteId = record.activeSiteIds[0] ?? sites[0]?.id;
            if (siteId) setImpactTarget({ siteId, code: record.code, packageId: record.id });
          },
          disabled: sites.length === 0,
          disabledReason: '没有可分析站点',
        },
        {
          key: 'rollback', label: '回滚站点', onClick: () => {
            setSiteLifecycleAction({ record, action: 'rollback' });
            setLifecycleSiteId(record.activeSiteIds[0]);
          },
          disabled: record.activeSiteIds.length === 0 || !hasPermission('cms:theme:activate'),
          disabledReason: record.activeSiteIds.length === 0 ? '该版本未在站点生效' : '缺少激活权限',
        },
        {
          key: 'deactivate-site', label: '停用站点主题', danger: true, onClick: () => {
            setSiteLifecycleAction({ record, action: 'deactivate' });
            setLifecycleSiteId(record.activeSiteIds[0]);
          },
          disabled: record.activeSiteIds.length === 0 || !hasPermission('cms:theme:activate'),
          disabledReason: '该版本未生效或缺少权限',
        },
        {
          key: 'export', label: '签名导出', onClick: () => request.download(`/api/cms/themes/${record.id}/export`, `${record.code}-${record.version}.zip`),
          disabled: !record.exportAvailable || !hasPermission('cms:theme:export'),
          disabledReason: record.exportAvailable ? '缺少导出权限' : '服务端未配置签名私钥',
        },
        {
          key: 'status', label: record.status === 'validated' ? '停用版本' : '恢复版本', danger: record.status === 'validated',
          onClick: async () => {
            await setPackageStatus.mutateAsync({ id: record.id, status: record.status === 'validated' ? 'disabled' : 'validated' });
            Toast.success('主题包状态已更新');
          },
          disabled: record.activeSiteIds.length > 0 || !hasPermission('cms:theme:activate') || (record.status === 'disabled' && !record.validationReport.valid),
          disabledReason: record.activeSiteIds.length > 0
            ? '请先停用所有站点部署'
            : !record.validationReport.valid ? '没有可信成功校验报告，请重新签名并导入' : '缺少激活权限',
        },
      ],
    }),
  ];

  const templatePrimary = (
    <>
      <Input prefix={<Search size={14} />} placeholder="模板名称/编码" value={templateDraft.keyword} showClear onChange={(keyword) => setTemplateDraft((prev) => ({ ...prev, keyword }))} />
      <Button type="primary" icon={<Search size={14} />} onClick={() => {
        templatePagination.setPage(1);
        setTemplateSubmitted(templateDraft);
        void queryClient.invalidateQueries({ queryKey: cmsTemplateKeys.lists });
      }}>查询</Button>
      <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => {
        const reset = { keyword: '', type: '', status: '', siteId: undefined };
        setTemplateDraft(reset);
        setTemplateSubmitted(reset);
        templatePagination.setPage(1);
        void queryClient.invalidateQueries({ queryKey: cmsTemplateKeys.lists });
      }}>重置</Button>
    </>
  );
  const templateFilters = (
    <>
      <Select placeholder="全部站点作用域" showClear optionList={siteOptions} value={templateDraft.siteId} onChange={(value) => setTemplateDraft((prev) => ({ ...prev, siteId: value ? Number(value) : undefined }))} style={{ width: 150 }} />
      <Select placeholder="模板类型" optionList={[{ value: '', label: '全部类型' }, ...CMS_TEMPLATE_TYPES.map((value) => ({ value, label: CMS_TEMPLATE_TYPE_LABELS[value] }))]} value={templateDraft.type} onChange={(value) => setTemplateDraft((prev) => ({ ...prev, type: String(value) }))} style={{ width: 150 }} />
      <Select placeholder="状态" optionList={[{ value: '', label: '全部状态' }, { value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} value={templateDraft.status} onChange={(value) => setTemplateDraft((prev) => ({ ...prev, status: String(value) }))} style={{ width: 130 }} />
    </>
  );

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" activeKey={activeTab} onChange={(key) => setActiveTab(key as TabKey)}>
        <TabPane tab="模板管理" itemKey="templates">
          <SearchToolbar
            primary={templatePrimary}
            filters={templateFilters}
            actions={hasPermission('cms:template:manage') ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreateTemplate}>新增</Button> : null}
            mobilePrimary={templatePrimary}
            mobileActions={hasPermission('cms:template:manage') ? <Button theme="borderless" type="primary" onClick={openCreateTemplate}>新增模板</Button> : null}
            onFilterApply={() => { setTemplateSubmitted(templateDraft); templatePagination.setPage(1); void queryClient.invalidateQueries({ queryKey: cmsTemplateKeys.lists }); }}
          />
          {templateListQuery.isError ? <Banner type="danger" description="模板列表加载失败，请检查权限或网络后使用表格刷新重试。" /> : null}
          <ConfigurableTable
            bordered
            rowKey="id"
            columns={templateColumns}
            dataSource={templates}
            loading={templateListQuery.isFetching}
            pagination={templatePagination.buildPagination(templateListQuery.data?.total ?? 0)}
            onRefresh={() => void templateListQuery.refetch()}
            refreshLoading={templateListQuery.isFetching}
            scroll={{ x: 1300 }}
          />
        </TabPane>
        <TabPane tab="主题包" itemKey="packages">
          <SearchToolbar
            primary={(
              <>
                <Input prefix={<Search size={14} />} placeholder="主题/编码/版本" value={packageDraft.keyword} showClear onChange={(keyword) => setPackageDraft((prev) => ({ ...prev, keyword }))} />
                <Button type="primary" icon={<Search size={14} />} onClick={() => { setPackageSubmitted(packageDraft); packagePagination.setPage(1); void queryClient.invalidateQueries({ queryKey: cmsThemePackageKeys.lists }); }}>查询</Button>
                <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { const reset = { keyword: '', status: '' }; setPackageDraft(reset); setPackageSubmitted(reset); packagePagination.setPage(1); void queryClient.invalidateQueries({ queryKey: cmsThemePackageKeys.lists }); }}>重置</Button>
              </>
            )}
            filters={<Select placeholder="状态" optionList={[{ value: '', label: '全部状态' }, { value: 'validated', label: '校验通过' }, { value: 'disabled', label: '已停用' }]} value={packageDraft.status} onChange={(status) => setPackageDraft((prev) => ({ ...prev, status: String(status) }))} style={{ width: 140 }} />}
            actions={hasPermission('cms:theme:import') ? <Button type="primary" icon={<Upload size={14} />} onClick={() => setUploadVisible(true)}>导入</Button> : null}
            mobileActions={hasPermission('cms:theme:import') ? <Button theme="borderless" type="primary" onClick={() => setUploadVisible(true)}>导入主题包</Button> : null}
            onFilterApply={() => { setPackageSubmitted(packageDraft); packagePagination.setPage(1); void queryClient.invalidateQueries({ queryKey: cmsThemePackageKeys.lists }); }}
          />
          <Banner
            type="info"
            style={{ marginBottom: 12 }}
            description={(
              <Space wrap>
                <Typography.Text>仓库内置可信主题也必须通过统一生命周期切换：</Typography.Text>
                {(['default', 'docs'] as const).map((code) => (
                  <Button
                    key={code}
                    theme="borderless"
                    disabled={!hasPermission('cms:theme:activate')}
                    onClick={() => { setBuiltinAction(code); setBuiltinSiteId(sites[0]?.id); }}
                  >
                    激活 {code}
                  </Button>
                ))}
              </Space>
            )}
          />
          {importTask ? (
            <Banner
              type={importTask.status === 'failed' ? 'danger' : importTask.status === 'success' ? 'success' : 'info'}
              style={{ marginBottom: 12 }}
              description={<AsyncTaskProgress task={importTask} />}
            />
          ) : null}
          {packageListQuery.isError ? <Banner type="danger" description="主题包列表加载失败，请检查权限或网络后使用表格刷新重试。" /> : null}
          <ConfigurableTable
            bordered
            rowKey="id"
            columns={packageColumns}
            dataSource={packages}
            loading={packageListQuery.isFetching}
            pagination={packagePagination.buildPagination(packageListQuery.data?.total ?? 0)}
            onRefresh={() => void packageListQuery.refetch()}
            refreshLoading={packageListQuery.isFetching}
            scroll={{ x: 1300 }}
          />
        </TabPane>
      </Tabs>

      <AppModal
        title={templateModal?.record ? `保存新版本 — ${templateModal.record.name}` : '新增声明式模板'}
        visible={templateModal != null}
        onCancel={() => setTemplateModal(null)}
        onOk={() => void saveTemplate()}
        confirmLoading={createTemplate.isPending || saveVersion.isPending || validateTemplate.isPending}
        width={860}
        closeOnEsc
      >
        <Form labelPosition="left" labelWidth={90}>
          <Space vertical spacing={12} style={{ width: '100%' }}>
            <Space wrap>
              <Select prefix="站点" optionList={siteOptions} value={templateForm.siteId} disabled={!!templateModal?.record} onChange={(value) => setTemplateForm((prev) => ({ ...prev, siteId: Number(value) }))} style={{ width: 210 }} />
              <Input prefix="主题" value={templateForm.themeCode} disabled={!!templateModal?.record} onChange={(themeCode) => setTemplateForm((prev) => ({ ...prev, themeCode }))} />
              <Select prefix="类型" optionList={CMS_TEMPLATE_TYPES.map((value) => ({ value, label: CMS_TEMPLATE_TYPE_LABELS[value] }))} value={templateForm.type} disabled={!!templateModal?.record} onChange={(value) => setTemplateForm((prev) => ({ ...prev, type: value as CmsTemplate['type'] }))} style={{ width: 180 }} />
            </Space>
            <Space wrap>
              <Input prefix="编码" value={templateForm.code} disabled={!!templateModal?.record} onChange={(code) => setTemplateForm((prev) => ({ ...prev, code }))} />
              <Input prefix="名称" value={templateForm.name} disabled={!!templateModal?.record} onChange={(name) => setTemplateForm((prev) => ({ ...prev, name }))} />
              <Input prefix="变更说明" value={templateForm.changeNote} onChange={(changeNote) => setTemplateForm((prev) => ({ ...prev, changeNote }))} />
            </Space>
            <Typography.Text strong>DSL JSON（仅允许版本化节点、属性、绑定与可信组件白名单）</Typography.Text>
            <textarea
              value={dslText}
              onChange={(event) => { setDslText(event.target.value); setDslReport(null); }}
              spellCheck={false}
              style={{ width: '100%', minHeight: 360, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: 12, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', background: 'var(--semi-color-bg-0)', color: 'var(--semi-color-text-0)' }}
            />
            <Space>
              <Button icon={<FileCheck2 size={14} />} loading={validateTemplate.isPending} onClick={() => void validateDsl()}>Schema 校验</Button>
              <Button onClick={() => { const dsl = parseDsl(dslText); if (dsl) setDslText(JSON.stringify(dsl, null, 2)); }}>格式化</Button>
            </Space>
            <ValidationBanner report={dslReport} />
          </Space>
        </Form>
      </AppModal>

      <SideSheet title={versionsTemplate ? `版本历史 — ${versionsTemplate.name}` : '版本历史'} visible={versionsTemplate != null} onCancel={() => setVersionsTemplate(null)} width={720}>
        <Space vertical spacing={10} style={{ width: '100%' }}>
          {(versionsQuery.data?.versions ?? []).map((version) => (
            <div key={version.id} style={{ padding: 12, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <div><Typography.Text strong>v{version.version}</Typography.Text> {version.version === versionsTemplate?.activeVersion ? <Tag color="green">生效中</Tag> : null}</div>
                <Space>
                  <Button theme="borderless" size="small" onClick={() => versionsTemplate && void runTemplatePreview(versionsTemplate, version.version)}>预览</Button>
                  <Button theme="borderless" size="small" onClick={() => versionsTemplate && void showDiff(versionsTemplate, version)}>差异</Button>
                  {versionsTemplate?.source !== 'package' ? <Button
                    theme="borderless"
                    size="small"
                    disabled={!hasPermission('cms:template:activate')}
                    onClick={async () => {
                      if (!versionsTemplate) return;
                      await rollbackTemplate.mutateAsync({ id: versionsTemplate.id, version: version.version });
                      Toast.success('已复制为新版本并激活');
                    }}
                  >回滚</Button> : null}
                </Space>
              </Space>
              <Typography.Paragraph type="tertiary" size="small">{version.changeNote ?? '无变更说明'} · {formatDateTime(version.createdAt)} · {version.checksum}</Typography.Paragraph>
            </div>
          ))}
        </Space>
      </SideSheet>

      <AppModal title="校验并导入签名主题包" visible={uploadVisible} onCancel={() => setUploadVisible(false)} onOk={() => void importValidatedPackage()} okButtonProps={{ disabled: !packageReport?.valid }} confirmLoading={importPackage.isPending} width={660} closeOnEsc>
        <input ref={uploadInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => void choosePackage(event.target.files?.[0])} />
        <Space vertical spacing={12} style={{ width: '100%' }}>
          <Button icon={<Upload size={14} />} onClick={() => uploadInput.current?.click()} loading={validatePackage.isPending}>选择 ZIP 并验证</Button>
          {uploadFile ? <Typography.Text>{uploadFile.name} · {Math.ceil(uploadFile.size / 1024)} KB</Typography.Text> : null}
          {packageReport ? (
            <Banner
              type={packageReport.valid ? 'success' : 'danger'}
              description={packageReport.valid
                ? `签名、校验和、ZIP 边界、DSL 与静态资源均通过；${packageReport.fileCount} 个文件`
                : packageReport.issues.map((item) => item.message).join('；')}
            />
          ) : <Banner type="warning" description="未配置可信公钥时服务端会 fail closed；主题包不得包含 JS/TSX、可执行文件、符号链接或越界路径。" />}
        </Space>
      </AppModal>

      <AppModal title={packageAction ? `激活主题 — ${packageAction.name} ${packageAction.version}` : '激活主题'} visible={packageAction != null} onCancel={() => setPackageAction(null)} onOk={() => void activateSelectedPackage()} confirmLoading={activatePackage.isPending} width={480} closeOnEsc>
        <Form labelPosition="left" labelWidth={90}>
          <Select prefix="目标站点" optionList={siteOptions} value={packageSiteId} onChange={(value) => setPackageSiteId(Number(value))} style={{ width: '100%' }} />
          <Banner style={{ marginTop: 12 }} type="warning" description="激活状态与通用任务中心 pending 重建记录在同一事务提交；每个站点全局仅一个 package deployment 生效。" />
        </Form>
      </AppModal>

      <AppModal
        title={`激活内置主题 — ${builtinAction ?? ''}`}
        visible={builtinAction != null}
        onCancel={() => setBuiltinAction(null)}
        onOk={() => void activateSelectedBuiltin()}
        confirmLoading={activateBuiltin.isPending}
        width={480}
        closeOnEsc
      >
        <Form labelPosition="left" labelWidth={90}>
          <Select prefix="目标站点" optionList={siteOptions} value={builtinSiteId} onChange={(value) => setBuiltinSiteId(Number(value))} style={{ width: '100%' }} />
          <Banner style={{ marginTop: 12 }} type="warning" description="切换将停用该站点当前 package deployment、更新主题修订号，并在同一事务创建待重建任务。" />
        </Form>
      </AppModal>

      <AppModal
        title={siteLifecycleAction?.action === 'rollback' ? '回滚站点主题版本' : '停用站点主题'}
        visible={siteLifecycleAction != null}
        onCancel={() => setSiteLifecycleAction(null)}
        onOk={() => void runSiteLifecycleAction()}
        confirmLoading={rollbackPackage.isPending || deactivatePackage.isPending}
        okButtonProps={siteLifecycleAction?.action === 'deactivate' ? { type: 'danger' } : undefined}
        width={480}
        closeOnEsc
      >
        <Form labelPosition="left" labelWidth={90}>
          <Select
            prefix="目标站点"
            optionList={sites.filter((site) => siteLifecycleAction?.record.activeSiteIds.includes(site.id)).map((site) => ({ value: site.id, label: site.name }))}
            value={lifecycleSiteId}
            onChange={(value) => setLifecycleSiteId(Number(value))}
            style={{ width: '100%' }}
          />
          <Banner
            style={{ marginTop: 12 }}
            type="warning"
            description={siteLifecycleAction?.action === 'rollback'
              ? '回滚会激活该站点上一主题包版本，并提交影响重建。'
              : '停用后站点回退仓库内置 default 主题，并提交影响重建。'}
          />
        </Form>
      </AppModal>

      <AppModal title="同源正式渲染预览" visible={previewHtml != null} onCancel={() => setPreviewHtml(null)} footer={null} width={1000} closeOnEsc>
        <iframe title="CMS 模板预览" srcDoc={previewHtml ?? ''} sandbox="" style={{ width: '100%', minHeight: '70vh', border: '1px solid var(--semi-color-border)' }} />
      </AppModal>

      <SideSheet title="主题健康与影响分析" visible={impactTarget != null} onCancel={() => setImpactTarget(null)} width={620}>
        {impactTarget ? (
          <Select
            prefix="评估站点"
            optionList={siteOptions}
            value={impactTarget.siteId}
            onChange={(value) => setImpactTarget((prev) => prev ? { ...prev, siteId: Number(value) } : prev)}
            style={{ width: '100%', marginBottom: 12 }}
          />
        ) : null}
        {impactQuery.isLoading ? <Typography.Text>加载中…</Typography.Text> : impactQuery.isError ? (
          <Banner type="danger" description="影响分析失败，请确认站点权限与主题状态后重试。" />
        ) : impactQuery.data ? (
          <Space vertical spacing={12} style={{ width: '100%' }}>
            <Descriptions
              data={[
                { key: '主题', value: impactQuery.data.themeCode },
                { key: '主题可用', value: impactQuery.data.themeAvailable ? '是' : '否' },
                { key: '当前活动版本', value: impactQuery.data.activePackageVersion ?? '内置/无' },
                { key: '本次评估版本', value: impactQuery.data.evaluatedPackageVersion ?? '内置/无' },
                { key: '影响栏目', value: impactQuery.data.affectedChannels },
                { key: '影响内容', value: impactQuery.data.affectedContents },
                { key: '影响页面', value: impactQuery.data.affectedPages },
                { key: '预计路径', value: impactQuery.data.estimatedPaths },
                { key: '待重建任务', value: impactQuery.data.pendingRebuildTasks },
              ]}
            />
            {impactQuery.data.invalidRefs.length ? <Banner type="danger" description={`发现 ${impactQuery.data.invalidRefs.length} 处失效模板引用，请先修复再激活。`} /> : <Banner type="success" description="未发现失效模板引用。" />}
            <Typography.Paragraph>{impactQuery.data.ranges.join('、')}</Typography.Paragraph>
          </Space>
        ) : null}
      </SideSheet>
    </div>
  );
}
