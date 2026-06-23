import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Button, Col, Dropdown, Form, Input, Modal, Row, Select, Space, Spin, Tag,
  Toast, Switch, Typography, Banner,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search, MoreHorizontal } from 'lucide-react';
import type { PaginatedResponse, MpAccount, MpAccountType } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { request } from '@/utils/request';
import { config } from '@/config';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';

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

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<MpAccount[]>([]);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();

  interface SearchParams { keyword: string; filterType: MpAccountType | undefined; filterStatus: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterType: undefined, filterStatus: undefined };
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MpAccount | null>(null);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<FormApi>(null);

  const [configRecord, setConfigRecord] = useState<MpAccount | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [togglingStatusId, setTogglingStatusId] = useState<number | null>(null);

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const { keyword: kw, filterType: tp, filterStatus: st } = params ?? searchParamsRef.current;
      setLoading(true);
      try {
        const query = new URLSearchParams({ page: String(p), pageSize: String(ps) });
        if (kw) query.set('keyword', kw);
        if (tp) query.set('type', tp);
        if (st) query.set('status', st);
        const res = await request.get<PaginatedResponse<MpAccount>>(`/api/mp/accounts?${query}`);
        setList(res.data?.list ?? []);
        setTotal(res.data?.total ?? 0);
        setPage(res.data?.page ?? p);
        setPageSize(res.data?.pageSize ?? ps);
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, setPage, setPageSize],
  );

  useEffect(() => {
    void fetchList(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => { setPage(1); void fetchList(1, pageSize); };
  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchList(1, pageSize, defaultSearchParams);
  };

  const openCreate = () => { setEditingRecord(null); setModalVisible(true); };
  const openEdit = async (record: MpAccount) => {
    setEditingRecord(record);
    setModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<MpAccount>(`/api/mp/accounts/${record.id}`);
    setModalDetailLoading(false);
    if (res.code === 0) setEditingRecord(res.data);
    else Toast.error(res.message || '获取信息失败');
  };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { return; }
    setSubmitting(true);
    try {
      if (editingRecord) {
        const payload: Record<string, unknown> = { ...values };
        if (!payload.appSecret) delete payload.appSecret;
        const res = await request.put(`/api/mp/accounts/${editingRecord.id}`, payload);
        if (res.code !== 0) return;
        Toast.success('更新成功');
      } else {
        const res = await request.post('/api/mp/accounts', values);
        if (res.code !== 0) return;
        Toast.success('创建成功');
      }
      setModalVisible(false);
      void fetchList();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetDefault = async (record: MpAccount) => {
    const res = await request.post(`/api/mp/accounts/${record.id}/default`);
    if (res.code !== 0) return;
    Toast.success('已设为默认');
    void fetchList();
  };

  const handleTest = async (record: MpAccount) => {
    setTestingId(record.id);
    try {
      const res = await request.post<{ success: boolean; message: string }>(`/api/mp/accounts/${record.id}/test`);
      if (res.code === 0) Toast.success(res.data?.message || '连接成功');
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = (record: MpAccount) => {
    Modal.confirm({
      title: `确定要删除公众号「${record.name}」吗？`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete(`/api/mp/accounts/${record.id}`);
        if (res.code !== 0) return;
        Toast.success('删除成功');
        void fetchList();
      },
    });
  };

  const handleToggleStatus = useCallback(async (record: MpAccount, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled' && record.isDefault) {
      Toast.warning('默认公众号不能禁用，请先将其他公众号设为默认');
      return;
    }
    setTogglingStatusId(record.id);
    try {
      const res = await request.put(`/api/mp/accounts/${record.id}`, { status: newStatus });
      if (res.code === 0) {
        Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
        void fetchList();
      }
    } finally {
      setTogglingStatusId(null);
    }
  }, [fetchList]);

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
      title: '状态', dataIndex: 'status', width: 80, align: 'center' as const, fixed: 'right' as const,
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
    {
      title: '操作', key: 'actions', width: 300, fixed: 'right' as const,
      render: (_: unknown, record: MpAccount) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => setConfigRecord(record)}>服务器配置</Button>
          {can('mp:account:default') && (
            <Button
              theme="borderless"
              size="small"
              disabled={record.isDefault}
              onClick={() => void handleSetDefault(record)}
            >设为默认</Button>
          )}
          {can('mp:account:update') && (
            <Button theme="borderless" size="small" onClick={() => void openEdit(record)}>编辑</Button>
          )}
          {(can('mp:account:token') || can('mp:account:delete')) && (
            <Dropdown
              trigger="click"
              position="bottomRight"
              render={
                <Dropdown.Menu>
                  {can('mp:account:token') && (
                    <Dropdown.Item disabled={testingId === record.id} onClick={() => void handleTest(record)}>
                      {testingId === record.id ? '测试中…' : '测试连接'}
                    </Dropdown.Item>
                  )}
                  {can('mp:account:delete') && (
                    <Dropdown.Item type="danger" onClick={() => handleDelete(record)}>删除</Dropdown.Item>
                  )}
                </Dropdown.Menu>
              }
            >
              <Button theme="borderless" size="small" icon={<MoreHorizontal size={14} />} />
            </Dropdown>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="搜索名称/微信号/AppID"
          value={searchParams.keyword} onChange={(v) => setSearchParams({ ...searchParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 220 }} />
        <Select placeholder="类型" value={searchParams.filterType} onChange={(v) => setSearchParams({ ...searchParams, filterType: v as MpAccountType | undefined })}
          optionList={TYPE_OPTIONS} showClear style={{ width: 120 }} />
        <Select placeholder="状态" value={searchParams.filterStatus} onChange={(v) => setSearchParams({ ...searchParams, filterStatus: v as string | undefined })}
          optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))} showClear style={{ width: 110 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {can('mp:account:create') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
        )}
      </SearchToolbar>

      <ConfigurableTable bordered loading={loading} onRefresh={() => void fetchList()} refreshLoading={loading} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total, fetchList)}
        scroll={{ x: 1400 }} />

      <AppModal title={editingRecord ? '编辑公众号' : '新增公众号'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); setModalDetailLoading(false); }}
        confirmLoading={submitting} okButtonProps={{ disabled: modalDetailLoading }} width={720}>
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
          allowEmpty
          labelPosition="left" labelWidth={120}
          initValues={editingRecord
            ? { ...editingRecord, appSecret: '' }
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
                placeholder={editingRecord ? '不修改请留空' : '请输入 AppSecret'}
                rules={editingRecord ? [] : [{ required: true, message: '请输入 AppSecret' }]} />
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
