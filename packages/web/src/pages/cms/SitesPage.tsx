/**
 * 站点管理（/cms/sites，菜单 component: 'cms/SitesPage'——入口路径不可移动）。
 *
 * 本文件是装配层：搜索/树视图状态、表格列定义、各工作流弹窗的开关编排。
 * 六个独立工作流拆分在 ./sites/ 子目录，签名统一 `{ site, onClose }`、
 * 各自持有查询与变更（enabled 由 site 驱动，关闭即停止轮询/请求）：
 * SiteEditSheet（8-tab 编辑）/ SiteUsersModal（授权用户）/ SiteOpenGrantsModal（开放授权）/
 * SiteMoveModal（移动）/ SiteInheritanceSheet（继承配置）/ SiteStaticSheet（静态化）。
 * settings JSONB ⇄ 表单映射的纯函数与单测见 ./sites/site-form-mapping.ts。
 */
import React, { useMemo, useRef, useState } from 'react';
import { Button, Modal, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Upload as UploadIcon, ChevronsDownUp, ChevronsUpDown, ListTree, List as ListIcon } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { createdAtColumn, renderEllipsis, renderEnabledStatusTag } from '@/utils/table-columns';
import { confirmDelete } from '@/utils/confirm';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { useTreeExpansion } from '@/hooks/useTreeExpansion';
import { cmsSiteExportUrl, cmsSiteKeys, useCmsSiteList, useCmsSiteTree, useDeleteCmsSites, useEnableSiteAnalytics, useImportCmsSite } from '@/hooks/queries/cms';
import { useSubmitCmsSiteGroupPublish } from '@/hooks/queries/cms-stage3';
import { CMS_STATIC_MODE_LABELS } from '@zenith/shared/cms';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import type { CmsSite } from '@zenith/shared/cms';
import { cmsPreviewUrl } from './CmsSiteSelect';
import SiteEditSheet from './sites/SiteEditSheet';
import SiteUsersModal from './sites/SiteUsersModal';
import SiteOpenGrantsModal from './sites/SiteOpenGrantsModal';
import SiteMoveModal from './sites/SiteMoveModal';
import SiteInheritanceSheet from './sites/SiteInheritanceSheet';
import SiteStaticSheet from './sites/SiteStaticSheet';

interface SearchParams {
  keyword: string;
  status?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

export default function SitesPage() {
  const { hasPermission } = usePermission();

  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({
    defaults: defaultSearchParams,
    // 树视图（默认）与列表视图各有独立 query key：两个都要失效，
    // 否则条件未变化时点「查询」在树视图下不会回源（表现为按钮没反应）
    listKey: cmsSiteKeys.lists,
    extraKeys: [...cmsSiteKeys.hierarchy],
  });
  const [treeView, setTreeView] = useState(true);

  const listQuery = useCmsSiteList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const treeQuery = useCmsSiteTree({
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  }, treeView);
  const tree = useMemo(() => treeQuery.data ?? [], [treeQuery.data]);
  const {
    expandedRowKeys, isAllExpanded: allExpanded, toggleExpandAll, onExpandedRowsChange,
  } = useTreeExpansion(tree);

  // ── 各工作流弹窗的开关状态（内容与数据由各组件自持） ──────────────────────
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<CmsSite | null>(null);
  const [usersSite, setUsersSite] = useState<CmsSite | null>(null);
  const [grantsSite, setGrantsSite] = useState<CmsSite | null>(null);
  const [moveSite, setMoveSite] = useState<CmsSite | null>(null);
  const [inheritanceSite, setInheritanceSite] = useState<CmsSite | null>(null);
  const [staticSheetSite, setStaticSheetSite] = useState<CmsSite | null>(null);

  const deleteMutation = useDeleteCmsSites();
  const enableAnalyticsMutation = useEnableSiteAnalytics();
  const groupPublishMutation = useSubmitCmsSiteGroupPublish();
  const importMutation = useImportCmsSite();
  const importFileRef = useRef<HTMLInputElement>(null);

  function openCreate() {
    setEditingSite(null);
    setEditSheetOpen(true);
  }

  function openEdit(record: CmsSite) {
    setEditingSite(record);
    setEditSheetOpen(true);
  }

  function closeEditSheet() {
    setEditSheetOpen(false);
    setEditingSite(null);
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync([id]);
    Toast.success('删除成功');
  }

  function handleGroupPublish(record: CmsSite) {
    Modal.confirm({
      title: `整组重建「${record.name}」及全部子站点？`,
      content: '系统会先校验全部目标站点与栏目 ACL，再为每个站点提交带 revision fence 的可取消任务。',
      onOk: async () => {
        const result = await groupPublishMutation.mutateAsync({ body: { rootSiteId: record.id } });
        Toast.success(`已提交 ${result.tasks.length} 个站点重建任务`);
      },
    });
  }

  // ─── 站点导入导出（P5 整站备份迁移）────────────────────────────────────────
  function handleExport(record: CmsSite) {
    void request.download(cmsSiteExportUrl(record.id), `cms-site-${record.code}-${Date.now()}.json`)
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
      Toast.success(`站点「${result.siteName}」导入成功（栏目 ${result.counts.channels ?? 0}、内容 ${result.counts.contents ?? 0}、部件 ${result.counts.widgets ?? 0}）`);
      if (result.warnings.length > 0) {
        Modal.warning({
          title: '导入完成，以下项目需要处理',
          content: (
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ),
        });
      }
    } catch {
      // 错误提示由请求层统一 Toast
    }
  }

  const columns: ColumnProps<CmsSite>[] = [
    { title: '站点名称', dataIndex: 'name', width: 240 },
    {
      title: '父级 / 层级',
      width: 200,
      render: (_: unknown, record) => record.parentName
        ? `${record.parentName} / L${record.depth ?? '-'}`
        : `根站点 / L${record.depth ?? 1}`,
    },
    { title: '标识', dataIndex: 'code', width: 160 },
    {
      title: '默认站点',
      dataIndex: 'isDefault',
      width: 90,
      align: 'center',
      render: (v: boolean) => v ? <Tag size="small" color="green">默认</Tag> : <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>,
    },
    {
      title: '域名',
      dataIndex: 'domain',
      width: 180,
      render: (v: string | null) => v || <span style={{ color: 'var(--semi-color-text-2)' }}>未绑定</span>,
    },
    { title: '有效主题', width: 110, render: (_: unknown, record) => record.effectiveTheme ?? record.theme },
    {
      title: '静态化模式',
      dataIndex: 'staticMode',
      width: 130,
      render: (_: unknown, record) => CMS_STATIC_MODE_LABELS[record.effectiveStaticMode ?? record.staticMode],
    },
    { title: 'SEO 标题', dataIndex: 'title', minWidth: 220, render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right',
      render: renderEnabledStatusTag,
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
        ...(hasPermission('cms:publish:build') ? [{
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
          onClick: () => setUsersSite(record),
        }, {
          key: 'open-grants',
          label: '开放授权',
          onClick: () => setGrantsSite(record),
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
                await enableAnalyticsMutation.mutateAsync({ params: { id: record.id } });
                Toast.success('已开通，重新生成静态页后生效');
              },
            });
          },
        }] : []),
        ...(hasPermission('cms:site:hierarchy') ? [{
          key: 'inheritance',
          label: '继承配置',
          onClick: () => setInheritanceSite(record),
        }, {
          key: 'move',
          label: '移动',
          onClick: () => setMoveSite(record),
        }] : []),
        ...(hasPermission('cms:publish:group') ? [{
          key: 'group-publish',
          label: '整组重建',
          onClick: () => handleGroupPublish(record),
        }] : []),
        ...(hasPermission('cms:site:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            confirmDelete({
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
    <KeywordInput placeholder="搜索名称/标识/域名..." value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderSearchButton = () => (
    <SearchButton onClick={handleSearch} />
  );
  const renderResetButton = () => (
    <ResetButton onClick={handleReset} />
  );
  const renderCreateButton = () => hasPermission('cms:site:create') ? (
    <CreateButton onClick={openCreate} />
  ) : null;
  const renderImportButton = () => hasPermission('cms:site:create') ? (
    <Button icon={<UploadIcon size={14} />} loading={importMutation.isPending} onClick={() => importFileRef.current?.click()}>导入</Button>
  ) : null;
  const renderViewToggle = () => (
    <Button
      type="tertiary"
      icon={treeView ? <ListIcon size={14} /> : <ListTree size={14} />}
      onClick={() => setTreeView((value) => !value)}
    >
      {treeView ? '列表视图' : '树视图'}
    </Button>
  );
  const renderExpandToggle = () => treeView ? (
    <Button
      type="tertiary"
      icon={allExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
      onClick={toggleExpandAll}
    >
      {allExpanded ? '全部折叠' : '全部展开'}
    </Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderViewToggle()}
            {renderExpandToggle()}
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
            {renderViewToggle()}
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
        dataSource={treeView ? tree : list}
        loading={treeView ? treeQuery.isFetching : listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无站点"
        expandedRowKeys={treeView ? expandedRowKeys : undefined}
        onExpandedRowsChange={onExpandedRowsChange}
        onRefresh={() => void (treeView ? treeQuery.refetch() : listQuery.refetch())}
        refreshLoading={treeView ? treeQuery.isFetching : listQuery.isFetching}
        pagination={treeView ? false : buildPagination(total)}
      />

      {/* 站点导入：隐藏文件选择器（读取导出包 JSON 后提交） */}
      <input type="file" accept=".json,application/json" hidden ref={importFileRef} onChange={(e) => void handleImportFile(e)} />

      <SiteEditSheet open={editSheetOpen} site={editingSite} onClose={closeEditSheet} />
      <SiteUsersModal site={usersSite} onClose={() => setUsersSite(null)} />
      <SiteOpenGrantsModal site={grantsSite} onClose={() => setGrantsSite(null)} />
      <SiteMoveModal site={moveSite} onClose={() => setMoveSite(null)} />
      <SiteInheritanceSheet site={inheritanceSite} onClose={() => setInheritanceSite(null)} />
      <SiteStaticSheet site={staticSheetSite} canBuild={hasPermission('cms:publish:build')} onClose={() => setStaticSheetSite(null)} />
    </div>
  );
}
