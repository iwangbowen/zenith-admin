/**
 * App 推送配置页。
 *
 * 聚合供应商凭证管理(一对一挂应用、密钥脱敏、APNs 环境)+ 测试发送(直发 RegistrationID)。
 * 厂商通道(华为/小米/OV/荣耀/APNs)在供应商后台配置,本页只管聚合商凭证。
 */
import { useRef, useState } from 'react';
import { Banner, Col, Form, Modal, Row, Spin, Switch, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import {
  PUSH_PROVIDER_LABELS,
  PUSH_PROVIDER_OPTIONS,
  type CreatePushConfigInput,
  type PushConfig,
  type PushProvider,
  type TestPushSendInput,
} from '@zenith/shared/messaging';
import ConfigurableTable from '@/components/ConfigurableTable';
import AppModal from '@/components/AppModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { confirmDelete } from '@/utils/confirm';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import { useAllClientApps } from '@/hooks/queries/app-releases';
import {
  pushConfigKeys,
  useDeletePushConfigs,
  usePushConfigDetail,
  usePushConfigList,
  useSavePushConfig,
  useTestPushSend,
} from '@/hooks/queries/push';

interface SearchParams {
  keyword: string;
  status?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

/** 测试发送对话框:直发 RegistrationID,不依赖设备登记 */
function TestSendModal({ config, onClose }: { config: PushConfig | null; onClose: () => void }) {
  const formApiRef = useRef<FormApi | null>(null);
  const testMutation = useTestPushSend();

  async function handleOk() {
    const api = formApiRef.current;
    if (!api || !config) return;
    let values: TestPushSendInput;
    try {
      values = await api.validate() as TestPushSendInput;
    } catch {
      return;
    }
    await testMutation.mutateAsync({ params: { id: config.id }, body: values });
    Toast.success('测试推送已发送,请在目标设备确认');
    onClose();
  }

  return (
    <Modal
      title={config ? `测试发送 · ${config.name}` : '测试发送'}
      visible={config != null}
      onOk={() => void handleOk()}
      onCancel={onClose}
      okButtonProps={{ loading: testMutation.isPending }}
      closeOnEsc
      width={560}
    >
      <Banner
        type="info"
        description="RegistrationID 由客户端集成推送 SDK 后获取(极光 App 内可查),直发指定设备验证凭证与通道。"
        style={{ marginBottom: 12 }}
      />
      <Form
        key={config?.id ?? 'closed'}
        getFormApi={(api) => { formApiRef.current = api; }}
        labelPosition="left"
        labelWidth={110}
        allowEmpty
        initValues={{ title: 'Zenith 推送测试', content: '这是一条测试推送,收到说明通道配置正确' }}
      >
        <Form.Input field="registrationId" label="RegistrationID" placeholder="目标设备的推送注册标识"
          rules={[{ required: true, message: 'RegistrationID 不能为空' }]} />
        <Form.Input field="title" label="标题" maxLength={200} />
        <Form.TextArea field="content" label="内容" rows={3} maxCount={1000} />
      </Form>
    </Modal>
  );
}

export default function PushConfigsPage() {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: pushConfigKeys.lists });

  const listQuery = usePushConfigList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const modal = useEditModal<PushConfig, Partial<CreatePushConfigInput>>({
    entityName: '推送配置',
    save: useSavePushConfig(),
    useDetail: usePushConfigDetail,
    defaults: { provider: 'jpush', apnsProduction: false, status: 'enabled' },
    labelWidth: 120,
    toValues: (r) => ({
      appId: r.appId,
      name: r.name,
      provider: r.provider,
      appKey: r.appKey,
      masterSecret: '',
      apnsProduction: r.apnsProduction,
      remark: r.remark ?? '',
    }),
  });

  const toggleMutation = useSavePushConfig();
  const deleteMutation = useDeletePushConfigs();
  const togglingId = toggleMutation.isPending ? (toggleMutation.variables?.id ?? null) : null;
  const [testConfig, setTestConfig] = useState<PushConfig | null>(null);

  const appsQuery = useAllClientApps();
  const appOptions = (appsQuery.data ?? []).map((a) => ({ value: a.id, label: a.name }));

  const { items: statusItems } = useDictItems('common_status');
  const canUpdate = hasPermission('system:push:update');

  const columns: ColumnProps<PushConfig>[] = [
    { title: '所属应用', dataIndex: 'appName', width: 140, render: renderEllipsis },
    { title: '名称', dataIndex: 'name', width: 160, render: renderEllipsis },
    {
      title: '供应商', dataIndex: 'provider', width: 100,
      render: (v: PushProvider) => PUSH_PROVIDER_LABELS[v],
    },
    { title: 'AppKey', dataIndex: 'appKey', width: 180, render: renderEllipsis },
    {
      title: 'APNs 环境', dataIndex: 'apnsProduction', width: 120,
      render: (v: boolean) => <Tag color={v ? 'green' : 'grey'} size="small">{v ? '生产' : '开发'}</Tag>,
    },
    { title: '备注', dataIndex: 'remark', minWidth: 180, render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, record: PushConfig) => (
        <Switch
          checked={record.status === 'enabled'}
          loading={togglingId === record.id}
          disabled={!canUpdate}
          size="small"
          onChange={(checked) => {
            const doToggle = () => toggleMutation.mutate(
              { id: record.id, values: { status: checked ? 'enabled' : 'disabled' } },
              { onSuccess: () => Toast.success(checked ? '已启用' : '已停用') },
            );
            if (checked) doToggle();
            else Modal.confirm({
              title: '确认停用',
              content: `停用后「${record.name}」将不再用于推送发送,确认停用？`,
              onOk: doToggle,
            });
          }}
        />
      ),
    },
    createOperationColumn<PushConfig>({
      width: 180,
      desktopInlineKeys: ['test', 'edit'],
      actions: (record) => [
        ...(hasPermission('system:push:send') ? [{
          key: 'test', label: '测试', onClick: () => setTestConfig(record),
        }] : []),
        ...(canUpdate ? [{ key: 'edit', label: '编辑', onClick: () => modal.openEdit(record) }] : []),
        ...(hasPermission('system:push:delete') ? [{
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            confirmDelete({
              title: `确定要删除推送配置「${record.name}」吗？`,
              content: '删除后依赖该配置的推送将无法发送',
              onOk: async () => {
                await deleteMutation.mutateAsync([record.id]);
                Toast.success('删除成功');
              },
            });
          },
        }] : []),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput
      placeholder="搜索名称 / 备注..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      onSearch={handleSearch}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={statusItems}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderCreateButton = () => hasPermission('system:push:create')
    ? <CreateButton onClick={modal.openCreate}>新增配置</CreateButton> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>
          {renderKeywordSearch()}
          {renderStatusFilter()}
          <SearchButton onClick={handleSearch} />
          <ResetButton onClick={handleReset} />
        </>}
        actions={renderCreateButton()}
        mobilePrimary={<>
          {renderKeywordSearch()}
          <SearchButton onClick={handleSearch} />
          {renderCreateButton()}
        </>}
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
        empty="暂无推送配置,新增聚合供应商凭证后即可推送"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />

      <AppModal {...modal.modalProps} width={720}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select field="appId" label="所属应用" style={{ width: '100%' }}
                  optionList={appOptions} disabled={modal.isEdit}
                  rules={[{ required: true, message: '请选择所属应用' }]} />
              </Col>
              <Col span={12}>
                <Form.Input field="name" label="配置名称" placeholder="如:极光-生产"
                  rules={[{ required: true, message: '名称不能为空' }]} />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select field="provider" label="供应商" style={{ width: '100%' }}
                  optionList={PUSH_PROVIDER_OPTIONS} />
              </Col>
              <Col span={12}>
                <Form.Switch field="apnsProduction" label="APNs 生产环境"
                  extraText="iOS 推送环境:开发阶段关闭(走 APNs 沙箱),上架后开启" />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="appKey" label="AppKey" placeholder="供应商后台的应用 AppKey"
                  rules={[{ required: true, message: 'AppKey 不能为空' }]} />
              </Col>
              <Col span={12}>
                <Form.Input
                  field="masterSecret"
                  label="MasterSecret"
                  mode="password"
                  placeholder={modal.isEdit ? '留空表示不修改' : '供应商后台的 Master Secret'}
                  rules={modal.isEdit ? [] : [{ required: true, message: 'MasterSecret 不能为空' }]}
                />
              </Col>
            </Row>
            <Form.TextArea field="remark" label="备注" rows={2} maxCount={500} placeholder="选填" />
          </Form>
        </Spin>
      </AppModal>

      <TestSendModal config={testConfig} onClose={() => setTestConfig(null)} />
    </div>
  );
}
