import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Select, Tag, Toast, Modal, Row, Col } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useAllUsers } from '@/hooks/queries/users';
import {
  useCmsSiteList, useCmsThemes, useSaveCmsSite, useDeleteCmsSite, cmsSiteKeys,
  useCmsSiteUsers, useSetCmsSiteUsers,
} from '@/hooks/queries/cms';
import { CMS_STATIC_MODE_LABELS, CMS_STATIC_MODES } from '@zenith/shared';
import type { CmsSite } from '@zenith/shared';
import { cmsPreviewUrl } from './CmsSiteSelect';

interface SearchParams {
  keyword: string;
  status: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

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
  const saveMutation = useSaveCmsSite();
  const deleteMutation = useDeleteCmsSite();

  // ─── 授权用户（站点级数据权限）────────────────────────────────────────────
  const [usersModalSite, setUsersModalSite] = useState<CmsSite | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const siteUsersQuery = useCmsSiteUsers(usersModalSite?.id, !!usersModalSite);
  const setSiteUsersMutation = useSetCmsSiteUsers();
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
    setModalVisible(true);
  }

  function openEdit(record: CmsSite) {
    setEditingRecord(record);
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
      }
    : { theme: 'default', staticMode: 'hybrid', status: 'enabled', isDefault: false, aliasDomains: [] };

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    if (!values.domain) values.domain = null;
    // 推送凭证并入 settings JSONB（保留既有 settings 键）
    const { baiduPushToken, indexNowKey, ...rest } = values;
    rest.settings = {
      ...(editingRecord?.settings ?? {}),
      baiduPushToken: String(baiduPushToken ?? '').trim(),
      indexNowKey: String(indexNowKey ?? '').trim(),
    };
    await saveMutation.mutateAsync({ id: editingRecord?.id, values: rest });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
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
      width: 110,
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
        ...(hasPermission('cms:site:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(record),
        }, {
          key: 'users',
          label: '授权用户',
          onClick: () => openUsersModal(record),
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
        actions={renderCreateButton()}
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
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />

      <AppModal
        title={editingRecord ? '编辑站点' : '新增站点'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={720}
        closeOnEsc
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={100}
        >
          <Row gutter={16}>
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
          <Form.Section text="SEO 设置">
            <Form.Input field="title" label="SEO 标题" placeholder="站点默认 title" />
            <Form.Input field="keywords" label="SEO 关键词" placeholder="逗号分隔" />
            <Form.TextArea field="description" label="SEO 描述" rows={2} />
            <Form.TextArea field="robots" label="robots.txt" rows={3} placeholder="留空使用默认规则（Allow all + Sitemap）" />
          </Form.Section>
          <Form.Section text="搜索推送（配置后发布内容自动推送搜索引擎）">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="baiduPushToken" label="百度推送 Token" placeholder="百度搜索资源平台 → 普通收录" />
              </Col>
              <Col span={12}>
                <Form.Input field="indexNowKey" label="IndexNow Key" placeholder="Bing 等引擎；key 文件自动托管" />
              </Col>
            </Row>
          </Form.Section>
          <Form.Section text="备案与版权">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="icp" label="ICP 备案号" />
              </Col>
              <Col span={12}>
                <Form.Input field="copyright" label="版权信息" />
              </Col>
            </Row>
            <Form.Input field="remark" label="备注" />
          </Form.Section>
        </Form>
      </AppModal>

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
    </div>
  );
}
