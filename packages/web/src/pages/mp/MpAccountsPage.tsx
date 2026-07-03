import { useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button, Col, Form, Input, Modal, Row, Select, Spin, Tag,
  Toast, Switch, Typography, Banner,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { MpAccount, MpAccountType } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { config } from '@/config';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import {
  mpAccountKeys,
  useDeleteMpAccount,
  useMpAccountDetail,
  useMpAccountList,
  useSaveMpAccount,
  useSetDefaultMpAccount,
  useTestMpAccount,
} from '@/hooks/queries/mp-accounts';

const TYPE_OPTIONS = [
  { label: '订阅号', value: 'subscribe' },
  { label: '服务号', value: 'service' },
  { label: '测试号', value: 'test' },
];

const ENCRYPT_MODE_OPTIONS = [
  { label: '明文模式', value: 'plaintext' },
  { label: '兼容模式', value: 'compatible' },
  { label: '安全模式', value: 'safe' },
];

const TYPE_TAG_COLOR: Record<MpAccountType, 'blue' | 'green' | 'grey'> = {
  subscribe: 'blue',
  service: 'green',
  test: 'grey',
};

/** 构造对外可访问的回调地址（同源反代部署下即为正确的微信服务器配置 URL） */
function buildCallbackUrl(id: number): string {
  const raw = config.apiBaseUrl ?? '';
  const base = /^https?:\/\//.test(raw) ? raw : `${globalThis.location.origin}${raw}`;
  return `${base.replace(/\/$/, '')}/api/public/mp/callback/${id}`;
}

export default function MpAccountsPage() {
  const { hasPermission: can } = usePermission();
  const queryClient = useQueryClient();
  const { items: statusItems } = useDictItems('common_status');

  const { page, pageSize, setPage, buildPagination } = usePagination();

  interface SearchParams { keyword: string; filterType: MpAccountType | undefined; filterStatus: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterType: undefined, filterStatus: undefined };
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MpAccount | null>(null);
  const formRef = useRef<FormApi>(null);

  const [configRecord, setConfigRecord] = useState<MpAccount | null>(null);
  const listQuery = useMpAccountList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    type: submittedParams.filterType,
    status: submittedParams.filterStatus,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const detailQuery = useMpAccountDetail(editingRecord?.id, modalVisible);
  const editing = editingRecord ? (detailQuery.data ?? editingRecord) : null;
  const modalDetailLoading = !!editingRecord && detailQuery.isFetching;
  const saveMutation = useSaveMpAccount();
  const setDefaultMutation = useSetDefaultMpAccount();
  const testMutation = useTestMpAccount();
  const deleteMutation = useDeleteMpAccount();
  const toggleStatusMutation = useSaveMpAccount();
  const submitting = saveMutation.isPending;
  const testingId = testMutation.isPending ? (testMutation.variables ?? null) : null;
  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: mpAccountKeys.lists });
  };
  const handleReset = () => {
    setPage(1);
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    void queryClient.invalidateQueries({ queryKey: mpAccountKeys.lists });
  };

  const openCreate = () => { setEditingRecord(null); setModalVisible(true); };
  const openEdit = (record: MpAccount) => {
    setEditingRecord(record);
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { throw new Error('validation'); }
    const payload: Record<string, unknown> = { ...values };
    if (editingRecord && !payload.appSecret) delete payload.appSecret;
    await saveMutation.mutateAsync({ id: editingRecord?.id, values: payload });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
  };

  const handleSetDefault = async (record: MpAccount) => {
    await setDefaultMutation.mutateAsync(record.id);
    Toast.success('已设为默认');
  };

  const handleTest = async (record: MpAccount) => {
    const data = await testMutation.mutateAsync(record.id);
    Toast.success(data.message || '连接成功');
  };

  const handleDelete = (record: MpAccount) => {
    Modal.confirm({
      title: `确定要删除公众号「${record.name}」吗？`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(record.id);
        Toast.success('删除成功');
      },
    });
  };

  const handleToggleStatus = async (record: MpAccount, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled' && record.isDefault) {
      Toast.warning('默认公众号不能禁用，请先将其他公众号设为默认');
      return;
    }
    await toggleStatusMutation.mutateAsync({ id: record.id, values: { status: newStatus } });
    Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
  };

  const columns = [
    { title: '公众号名称', dataIndex: 'name', width: 160, render: renderEllipsis },
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (v: MpAccountType) => (
        <Tag color={TYPE_TAG_COLOR[v]} type="light">{TYPE_OPTIONS.find((t) => t.value === v)?.label ?? v}</Tag>
      ),
    },
    { title: 'AppID', dataIndex: 'appId', width: 200, render: renderEllipsis },
    { title: '微信号', dataIndex: 'account', width: 150, render: (v: string | null) => v || '—' },
    {
      title: '默认', dataIndex: 'isDefault', width: 70, align: 'center' as const,
      render: (v: boolean) => (v ? <Tag color="blue" type="light">默认</Tag> : '—'),
    },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right' as const,
      render: (v: string, record: MpAccount) => (
        <Switch
          size="small"
          checked={v === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={!can('mp:account:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    createOperationColumn<MpAccount>({
      width: 300,
      desktopInlineKeys: ['config', 'default', 'edit'],
      menuAriaLabel: '公众号账号操作',
      actions: (record) => [
        { key: 'config', label: '服务器配置', onClick: () => setConfigRecord(record) },
        {
          key: 'default',
          label: '设为默认',
          disabled: record.isDefault,
          hidden: !can('mp:account:default'),
          onClick: () => void handleSetDefault(record),
        },
        { key: 'edit', label: '编辑', hidden: !can('mp:account:update'), onClick: () => openEdit(record) },
        {
          key: 'test',
          label: testingId === record.id ? '测试中...' : '测试连接',
          loading: testingId === record.id,
          hidden: !can('mp:account:token'),
          onClick: () => void handleTest(record),
        },
        { key: 'delete', label: '删除', danger: true, hidden: !can('mp:account:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const renderKeywordInput = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索名称/微信号/AppID"
      value={draftParams.keyword}
      onChange={(v) => setDraftParams({ ...draftParams, keyword: v })}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 220 }}
    />
  );
  const renderTypeFilter = () => (
    <Select
      placeholder="类型"
      value={draftParams.filterType}
      onChange={(v) => setDraftParams({ ...draftParams, filterType: v as MpAccountType | undefined })}
      optionList={TYPE_OPTIONS}
      showClear
      style={{ width: 120 }}
    />
  );
  const renderStatusFilter = () => (
    <Select
      placeholder="状态"
      value={draftParams.filterStatus}
      onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as string | undefined })}
      optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))}
      showClear
      style={{ width: 110 }}
    />
  );
  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => can('mp:account:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordInput()}
            {renderTypeFilter()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordInput()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderTypeFilter()}
            {renderStatusFilter()}
          </>
        )}
        filterTitle="公众号账号筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)}
      />

      <AppModal title={editingRecord ? '编辑公众号' : '新增公众号'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        confirmLoading={submitting} okButtonProps={{ disabled: modalDetailLoading }} width={720}>
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
          <Form
            key={editing?.id ?? 'new'}
            getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
            allowEmpty
            labelPosition="left" labelWidth={120}
            initValues={editing
              ? { ...editing, appSecret: '' }
              : { status: 'enabled', isDefault: false, type: 'service', encryptMode: 'plaintext' }}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="name" label="公众号名称" placeholder="请输入公众号名称"
                  rules={[{ required: true, message: '请输入公众号名称' }]} />
              </Col>
              <Col span={12}>
                <Form.Select field="type" label="账号类型" style={{ width: '100%' }} optionList={TYPE_OPTIONS}
                  placeholder="请选择账号类型" rules={[{ required: true, message: '请选择账号类型' }]} />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="account" label="微信号" placeholder="原始ID，如 gh_xxxx" />
              </Col>
              <Col span={12}>
                <Form.Input field="appId" label="AppID" placeholder="请输入 AppID"
                  rules={[{ required: true, message: '请输入 AppID' }]} />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="appSecret" label="AppSecret" mode="password"
                  placeholder={editing ? '不修改请留空' : '请输入 AppSecret'}
                  rules={editing ? [] : [{ required: true, message: '请输入 AppSecret' }]} />
              </Col>
              <Col span={12}>
                <Form.Input field="token" label="Token" placeholder="服务器配置 Token，仅限字母数字"
                  rules={[{ required: true, message: '请输入 Token' }]} />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select field="encryptMode" label="消息加解密" style={{ width: '100%' }} optionList={ENCRYPT_MODE_OPTIONS}
                  placeholder="请选择消息加解密方式" />
              </Col>
              <Col span={12}>
                <Form.Input field="encodingAesKey" label="AESKey" placeholder="安全/兼容模式必填，43位" />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select field="status" label="状态" style={{ width: '100%' }} placeholder="请选择状态"
                  optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
              </Col>
              <Col span={12}>
                <Form.Switch field="isDefault" label="设为默认" />
              </Col>
              <Col span={12}>
                <Form.Switch field="autoCreateMember" label="关注即注册会员" extraText="开启后，粉丝关注时自动创建并绑定会员" />
              </Col>
              <Col span={12}>
                <Form.Switch field="contentCheckEnabled" label="内容安全校验" extraText="开启后，群发/客服消息发送前自动做敏感词校验" />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={24}>
                <Form.Input field="qrCodeUrl" label="二维码地址" placeholder="公众号二维码图片 URL（选填）" />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={24}>
                <Form.TextArea field="remark" label="备注" rows={2} placeholder="请输入备注" />
              </Col>
            </Row>
          </Form>
        </Spin>
      </AppModal>

      <AppModal title="微信服务器配置" visible={!!configRecord} footer={null}
        onCancel={() => setConfigRecord(null)} width={640}>
        {configRecord && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Banner type="info" fullMode={false} closeIcon={null}
              description="将以下信息填入微信公众平台「设置与开发 → 基本配置 → 服务器配置(URL/Token/EncodingAESKey)」，提交后微信会回调校验本地址。需保证服务器可被公网访问。" />
            <ConfigRow label="服务器地址(URL)" value={buildCallbackUrl(configRecord.id)} />
            <ConfigRow label="Token" value={configRecord.token} />
            <ConfigRow label="EncodingAESKey" value={configRecord.encodingAesKey || '（未配置）'} copyable={!!configRecord.encodingAesKey} />
            <ConfigRow label="消息加解密方式"
              value={ENCRYPT_MODE_OPTIONS.find((m) => m.value === configRecord.encryptMode)?.label ?? configRecord.encryptMode}
              copyable={false} />
          </div>
        )}
      </AppModal>
    </div>
  );
}

function ConfigRow({ label, value, copyable = true }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
      <span style={{ flexShrink: 0, width: 130, color: 'var(--semi-color-text-2)' }}>{label}</span>
      <Typography.Text copyable={copyable ? { content: value } : false} style={{ wordBreak: 'break-all' }}>{value}</Typography.Text>
    </div>
  );
}
