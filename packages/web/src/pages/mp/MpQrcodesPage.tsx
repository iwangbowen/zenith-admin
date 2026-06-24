import { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Form, Image, Input, Modal, Select, Space, Spin, Tag, Toast, Banner, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { PaginatedResponse, MpQrcode, MpQrcodeType } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createdAtColumn } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';

const TYPE_OPTIONS = [
  { label: '永久二维码', value: 'permanent' },
  { label: '临时二维码', value: 'temporary' },
];
const TYPE_META: Record<MpQrcodeType, { label: string; color: 'green' | 'orange' }> = {
  permanent: { label: '永久', color: 'green' },
  temporary: { label: '临时', color: 'orange' },
};

export default function MpQrcodesPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, currentIdRef, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<MpQrcode[]>([]);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();

  interface SearchParams { filterType: MpQrcodeType | undefined; keyword: string; }
  const defaultSearch: SearchParams = { filterType: undefined, keyword: '' };
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearch);
  const searchRef = useRef<SearchParams>(defaultSearch);
  searchRef.current = searchParams;

  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<MpQrcodeType>('permanent');
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<FormApi>(null);

  const fetchList = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    if (!currentId) { setList([]); setTotal(0); return; }
    const reqId = currentId;
    const { filterType, keyword } = params ?? searchRef.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(p), pageSize: String(ps), accountId: String(currentId) });
      if (filterType) q.set('type', filterType);
      if (keyword) q.set('keyword', keyword);
      const res = await request.get<PaginatedResponse<MpQrcode>>(`/api/mp/qrcodes?${q}`);
      if (currentIdRef.current !== reqId) return; // 账号已切换，丢弃过期响应
      setList(res.data?.list ?? []);
      setTotal(res.data?.total ?? 0);
      setPage(res.data?.page ?? p);
      setPageSize(res.data?.pageSize ?? ps);
    } finally {
      if (currentIdRef.current === reqId) setLoading(false);
    }
  }, [page, pageSize, currentId, currentIdRef, setPage, setPageSize]);

  useEffect(() => {
    setPage(1);
    void fetchList(1, pageSize, searchRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const handleSearch = () => { setPage(1); void fetchList(1, pageSize); };
  const handleReset = () => { setSearchParams(defaultSearch); setPage(1); void fetchList(1, pageSize, defaultSearch); };

  const openCreate = () => { setModalType('permanent'); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { return; }
    if (!currentId) return;
    const payload: Record<string, unknown> = {
      accountId: currentId,
      type: modalType,
      sceneStr: values.sceneStr,
      name: values.name,
    };
    if (modalType === 'temporary') payload.expireSeconds = values.expireSeconds;
    payload.rewardPoints = values.rewardPoints ?? 0;

    setSubmitting(true);
    try {
      const res = await request.post('/api/mp/qrcodes', payload);
      if (res.code !== 0) return;
      Toast.success('生成成功');
      setModalVisible(false);
      void fetchList();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (record: MpQrcode) => {
    Modal.confirm({
      title: '确定要删除该二维码吗？',
      content: '删除后本地记录移除，已投放的二维码图片仍可能被扫描。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete(`/api/mp/qrcodes/${record.id}`);
        if (res.code !== 0) return;
        Toast.success('删除成功');
        void fetchList();
      },
    });
  };

  const columns = [
    { title: '名称', dataIndex: 'name', width: 160, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 150 }}>{v}</Typography.Text> },
    { title: '场景值', dataIndex: 'sceneStr', width: 180, render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
    { title: '类型', dataIndex: 'type', width: 90, render: (v: MpQrcodeType) => <Tag color={TYPE_META[v].color} type="light">{TYPE_META[v].label}</Tag> },
    { title: '扫码次数', dataIndex: 'scanCount', width: 100, align: 'center' as const },
    { title: '奖励积分', dataIndex: 'rewardPoints', width: 100, align: 'center' as const, render: (v: number) => (v > 0 ? <Typography.Text type="success">+{v}</Typography.Text> : '—') },
    {
      title: '二维码', dataIndex: 'url', width: 90, align: 'center' as const,
      render: (v: string | null) => (v
        ? <Image src={v} width={48} height={48} style={{ borderRadius: 4 }} />
        : '—'),
    },
    createdAtColumn,
    {
      title: '操作', key: 'actions', width: 100, fixed: 'right' as const,
      render: (_: unknown, record: MpQrcode) => (
        <Space>
          {can('mp:qrcode:delete') && <Button theme="borderless" type="danger" size="small" onClick={() => handleDelete(record)}>删除</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
        <Select placeholder="类型" value={searchParams.filterType} onChange={(v) => setSearchParams({ ...searchParams, filterType: v as MpQrcodeType | undefined })}
          optionList={TYPE_OPTIONS} showClear style={{ width: 130 }} />
        <Input prefix={<Search size={14} />} placeholder="搜索名称 / 场景值" value={searchParams.keyword} showClear
          onChange={(v) => setSearchParams({ ...searchParams, keyword: v })} onEnterPress={handleSearch} style={{ width: 200 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {can('mp:qrcode:create') && <Button type="primary" icon={<Plus size={14} />} disabled={!currentId} onClick={openCreate}>生成二维码</Button>}
      </SearchToolbar>

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <ConfigurableTable bordered loading={loading} onRefresh={() => void fetchList()} refreshLoading={loading} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total, fetchList)} scroll={{ x: 1000 }} />

      <AppModal title="生成带参二维码" visible={modalVisible}
        onOk={handleSubmit} onCancel={() => setModalVisible(false)} confirmLoading={submitting} width={560}>
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form
            key={`new-${modalType}`}
            getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
            labelPosition="left" labelWidth={90}
            initValues={{ sceneStr: '', name: '', expireSeconds: 604800, rewardPoints: 0 }}
          >
            <Form.Slot label="二维码类型">
              <Select style={{ width: '100%' }} optionList={TYPE_OPTIONS} value={modalType} onChange={(v) => setModalType(v as MpQrcodeType)} />
            </Form.Slot>
            <Form.Input field="name" label="名称" placeholder="如：线下门店物料"
              rules={[{ required: true, message: '请输入名称' }]} maxLength={100} />
            <Form.Input field="sceneStr" label="场景值" placeholder="渠道标识，仅字母/数字/下划线/连字符"
              rules={[{ required: true, message: '请输入场景值' }, { pattern: /^[A-Za-z0-9_-]+$/, message: '仅支持字母、数字、下划线、连字符' }]} maxLength={64} />
            {modalType === 'temporary' && (
              <Form.InputNumber field="expireSeconds" label="有效期(秒)" style={{ width: '100%' }} min={60} max={2592000} step={60}
                rules={[{ required: true, message: '请设置有效期' }]} />
            )}
            <Form.InputNumber field="rewardPoints" label="扫码奖励积分" style={{ width: '100%' }} min={0} max={100000}
              extraText="扫码关注的粉丝若已绑定会员，自动入账该积分；0 表示不奖励" />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
