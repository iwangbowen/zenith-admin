import { useState } from 'react';
import { Banner, Button, Col, Form, Row, SideSheet, Spin, Switch, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { USER_STATUSES, enumValueOf } from '@zenith/shared/core';
import { MP_ACCOUNT_TYPES, type CreateMpAccountInput, type MpAccount, type MpAccountType } from '@zenith/shared/mp';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import { config } from '@/config';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import {
  mpAccountKeys,
  useDeleteMpAccounts,
  useMpAccountDetail,
  useMpAccountList,
  useSaveMpAccount,
  useSetDefaultMpAccount,
  useTestMpAccount,
} from '@/hooks/queries/mp-accounts';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';

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
  const { items: statusItems } = useDictItems('common_status');

  interface SearchParams { keyword: string; filterType: MpAccountType | undefined; filterStatus: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterType: undefined, filterStatus: undefined };
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: mpAccountKeys.lists });

  const [configRecord, setConfigRecord] = useState<MpAccount | null>(null);
  const listQuery = useMpAccountList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    type: enumValueOf(MP_ACCOUNT_TYPES, submittedParams.filterType),
    status: enumValueOf(USER_STATUSES, submittedParams.filterStatus),
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const saveMutation = useSaveMpAccount();
  const modal = useEditModal<MpAccount, Partial<CreateMpAccountInput>>({
    entityName: '公众号',
    save: saveMutation,
    useDetail: useMpAccountDetail,
    defaults: { status: 'enabled', isDefault: false, type: 'service', encryptMode: 'plaintext' },
    toValues: (record) => ({
      name: record.name,
      account: record.account ?? undefined,
      appId: record.appId,
      appSecret: '',
      token: record.token,
      encodingAesKey: record.encodingAesKey ?? undefined,
      encryptMode: record.encryptMode,
      type: record.type,
      qrCodeUrl: record.qrCodeUrl ?? undefined,
      isDefault: record.isDefault,
      autoCreateMember: record.autoCreateMember,
      contentCheckEnabled: record.contentCheckEnabled,
      status: record.status,
      remark: record.remark ?? undefined,
    }),
    beforeSave: (values, { isEdit }) => {
      const payload = { ...values };
      if (isEdit && !payload.appSecret) delete payload.appSecret;
      return payload;
    },
    labelWidth: 120,
  });
  const setDefaultMutation = useSetDefaultMpAccount();
  const testMutation = useTestMpAccount();
  const deleteMutation = useDeleteMpAccounts();
  const toggleStatusMutation = useSaveMpAccount();
  const testingId = testMutation.isPending ? (testMutation.variables?.params.id ?? null) : null;
  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  const handleSetDefault = async (record: MpAccount) => {
    await setDefaultMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('已设为默认');
  };

  const handleTest = async (record: MpAccount) => {
    const data = await testMutation.mutateAsync({ params: { id: record.id } });
    Toast.success(data.message || '连接成功');
  };

  const handleDelete = (record: MpAccount) => {
    confirmDelete({
      title: `确定要删除公众号「${record.name}」吗？`,
      onOk: async () => {
        await deleteMutation.mutateAsync([record.id]);
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
    { title: '公众号名称', dataIndex: 'name', minWidth: 160, render: renderEllipsis },
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (v: MpAccountType) => (
        <Tag color={TYPE_TAG_COLOR[v]} type="light">{TYPE_OPTIONS.find((t) => t.value === v)?.label ?? v}</Tag>
      ),
    },
    { title: 'AppID', dataIndex: 'appId', width: 200, render: renderEllipsis },
    { title: '微信号', dataIndex: 'account', width: 150, render: (v: string | null) => v || '—' },
    {
      title: '默认', dataIndex: 'isDefault', width: 80, align: 'center' as const,
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
      width: 220,
      desktopInlineKeys: ['config', 'edit'],
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
        { key: 'edit', label: '编辑', hidden: !can('mp:account:update'), onClick: () => modal.openEdit(record) },
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
    <KeywordInput placeholder="搜索名称/微信号/AppID" value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onSearch={handleSearch} />
  );
  const renderTypeFilter = () => (
    <FilterSelect
      placeholder="全部类型"
      items={TYPE_OPTIONS}
      value={draftParams.filterType}
      onChange={(v) => setDraftParams({ ...draftParams, filterType: v as MpAccountType | undefined })}
    />
  );
  const renderStatusFilter = () => (
    <StatusSelect
      items={statusItems}
      value={draftParams.filterStatus}
      onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as string | undefined })}
    />
  );
  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const renderCreateButton = () => can('mp:account:create') ? (
    <CreateButton onClick={modal.openCreate} />
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

      <SideSheet
        title={modal.modalProps.title}
        visible={modal.visible}
        onCancel={modal.close}
        closeOnEsc
        width={780}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="tertiary" onClick={modal.close}>取消</Button>
            <Button
              type="primary"
              theme="solid"
              loading={modal.modalProps.okButtonProps.loading}
              disabled={modal.modalProps.okButtonProps.disabled}
              onClick={() => void modal.modalProps.onOk()}
            >
              保存
            </Button>
          </div>
        )}
      >
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Form.Section text="基础信息">
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
                  <Form.Select field="status" label="状态" style={{ width: '100%' }} placeholder="请选择状态"
                    optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
                </Col>
              </Row>
              <Form.Input field="qrCodeUrl" label="二维码地址" placeholder="公众号二维码图片 URL（选填）" />
              <Form.TextArea field="remark" label="备注" rows={2} placeholder="请输入备注" />
            </Form.Section>

            <Form.Section text="开发者配置（对应微信公众平台「基本配置」）">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="appId" label="AppID" placeholder="请输入 AppID"
                    rules={[{ required: true, message: '请输入 AppID' }]} />
                </Col>
                <Col span={12}>
                  <Form.Input field="appSecret" label="AppSecret" mode="password"
                    placeholder={modal.isEdit ? '不修改请留空' : '请输入 AppSecret'}
                    rules={modal.isEdit ? [] : [{ required: true, message: '请输入 AppSecret' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="token" label="Token" placeholder="服务器配置 Token，仅限字母数字"
                    rules={[{ required: true, message: '请输入 Token' }]} />
                </Col>
                <Col span={12}>
                  <Form.Select field="encryptMode" label="消息加解密" style={{ width: '100%' }} optionList={ENCRYPT_MODE_OPTIONS}
                    placeholder="请选择消息加解密方式" />
                </Col>
              </Row>
              <Form.Input field="encodingAesKey" label="AESKey" placeholder="安全/兼容模式必填，43位" />
            </Form.Section>

            <Form.Section text="功能开关">
              <Row gutter={16}>
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
            </Form.Section>
          </Form>
        </Spin>
      </SideSheet>

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
