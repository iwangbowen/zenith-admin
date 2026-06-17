import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Select, Form, Toast, Tag, Popconfirm } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw, Plus, Send } from 'lucide-react';
import type { Coupon, CouponType, CouponTemplateStatus, PaginatedResponse } from '@zenith/shared';
import { COUPON_TYPE_LABELS, COUPON_TEMPLATE_STATUS_LABELS } from '@zenith/shared';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { formatDateTimeForApi } from '@/utils/date';

const typeOptions = (Object.keys(COUPON_TYPE_LABELS) as CouponType[]).map((v) => ({ value: v, label: COUPON_TYPE_LABELS[v] }));
const statusOptions = (Object.keys(COUPON_TEMPLATE_STATUS_LABELS) as CouponTemplateStatus[]).map((v) => ({ value: v, label: COUPON_TEMPLATE_STATUS_LABELS[v] }));
const STATUS_COLORS: Record<string, string> = { draft: 'grey', active: 'green', paused: 'orange', expired: 'red' };

const yuan = (fen: number) => (fen / 100).toFixed(2);
const renderFace = (r: Coupon) => (r.type === 'amount' ? `¥${yuan(r.faceValue)}` : `${r.faceValue}%`);
const renderThreshold = (v: number) => (v > 0 ? `满¥${yuan(v)}` : '无门槛');
const renderValid = (r: Coupon) =>
  r.validType === 'fixed' ? `${r.validStart ?? '-'} ~ ${r.validEnd ?? '-'}` : `领取后 ${r.validDays ?? 0} 天`;
const renderQuantity = (r: Coupon) => `${r.issuedQuantity}/${r.totalQuantity > 0 ? r.totalQuantity : '不限'}`;

interface SearchParams { keyword?: string; status?: CouponType | string; type?: string }
interface FormValues {
  name: string; type: CouponType; faceValue: number; threshold?: number; maxDiscount?: number;
  totalQuantity?: number; perLimit?: number; validType: 'fixed' | 'relative';
  validStart?: string | Date; validEnd?: string | Date; validDays?: number;
  status: CouponTemplateStatus; description?: string;
}

export default function CouponsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi<FormValues> | null>(null);
  const issueFormApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<Coupon[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [search, setSearch] = useState<SearchParams>({});
  const searchRef = useRef<SearchParams>({});
  searchRef.current = search;

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [formType, setFormType] = useState<CouponType>('amount');
  const [formValidType, setFormValidType] = useState<'fixed' | 'relative'>('fixed');

  const [issueVisible, setIssueVisible] = useState(false);
  const [issuing, setIssuing] = useState<Coupon | null>(null);

  const fetchData = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const ap = params ?? searchRef.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({
        page: String(p), pageSize: String(ps),
        ...(ap.keyword ? { keyword: ap.keyword } : {}),
        ...(ap.status ? { status: ap.status } : {}),
        ...(ap.type ? { type: ap.type } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<Coupon>>(`/api/coupons?${q}`);
      if (res.code === 0) { setData(res.data.list); setTotal(res.data.total); }
    } finally { setLoading(false); }
  }, [page, pageSize]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const handleSearch = () => { setPage(1); void fetchData(1, pageSize); };
  const handleReset = () => { setSearch({}); setPage(1); void fetchData(1, pageSize, {}); };

  const openCreate = () => {
    setEditing(null);
    setFormType('amount');
    setFormValidType('fixed');
    setModalVisible(true);
  };
  const openEdit = (r: Coupon) => {
    setEditing(r);
    setFormType(r.type);
    setFormValidType(r.validType);
    setModalVisible(true);
  };

  const initValues = (): Partial<FormValues> => {
    if (!editing) return { type: 'amount', validType: 'fixed', status: 'draft', threshold: 0, totalQuantity: 0, perLimit: 0 };
    return {
      name: editing.name,
      type: editing.type,
      faceValue: editing.type === 'amount' ? editing.faceValue / 100 : editing.faceValue,
      threshold: editing.threshold / 100,
      maxDiscount: editing.maxDiscount ? editing.maxDiscount / 100 : undefined,
      totalQuantity: editing.totalQuantity,
      perLimit: editing.perLimit,
      validType: editing.validType,
      validStart: editing.validStart ?? undefined,
      validEnd: editing.validEnd ?? undefined,
      validDays: editing.validDays ?? undefined,
      status: editing.status,
      description: editing.description ?? undefined,
    };
  };

  const handleSubmit = async () => {
    let v: FormValues;
    try { v = await formApi.current!.validate(); } catch { throw new Error('validation'); }
    const payload = {
      name: v.name,
      type: v.type,
      status: v.status,
      description: v.description ?? null,
      faceValue: v.type === 'amount' ? Math.round(v.faceValue * 100) : v.faceValue,
      threshold: Math.round((v.threshold ?? 0) * 100),
      maxDiscount: v.type === 'percent' && v.maxDiscount ? Math.round(v.maxDiscount * 100) : null,
      totalQuantity: v.totalQuantity ?? 0,
      perLimit: v.perLimit ?? 0,
      validType: v.validType,
      validStart: v.validType === 'fixed' && v.validStart ? formatDateTimeForApi(v.validStart) : undefined,
      validEnd: v.validType === 'fixed' && v.validEnd ? formatDateTimeForApi(v.validEnd) : undefined,
      validDays: v.validType === 'relative' ? v.validDays ?? null : null,
    };
    const res = editing
      ? await request.put(`/api/coupons/${editing.id}`, payload)
      : await request.post('/api/coupons', payload);
    if (res.code === 0) { Toast.success(editing ? '已更新' : '已创建'); setModalVisible(false); void fetchData(); }
    else throw new Error(res.message);
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/coupons/${id}`);
    if (res.code === 0) { Toast.success('已删除'); void fetchData(); }
    else Toast.error(res.message);
  };

  const openIssue = (r: Coupon) => { setIssuing(r); setIssueVisible(true); };
  const handleIssue = async () => {
    let values: { memberId: number };
    try { values = (await issueFormApi.current?.validate()) as { memberId: number }; } catch { throw new Error('validation'); }
    const res = await request.post(`/api/coupons/${issuing!.id}/issue`, { memberId: values.memberId });
    if (res.code === 0) { Toast.success('发放成功'); setIssueVisible(false); void fetchData(); }
    else throw new Error(res.message);
  };

  const canEdit = hasPermission('member:coupon:update');
  const canDelete = hasPermission('member:coupon:delete');
  const canIssue = hasPermission('member:coupon:issue');
  const hasOps = canEdit || canDelete || canIssue;

  const columns: ColumnProps<Coupon>[] = [
    { title: '名称', dataIndex: 'name', width: 160, render: renderEllipsis, fixed: 'left' },
    { title: '类型', dataIndex: 'type', width: 90, render: (v: CouponType) => <Tag color={v === 'amount' ? 'green' : 'blue'}>{COUPON_TYPE_LABELS[v]}</Tag> },
    { title: '面值', dataIndex: 'faceValue', width: 100, render: (_: number, r: Coupon) => renderFace(r) },
    { title: '门槛', dataIndex: 'threshold', width: 110, render: renderThreshold },
    { title: '已发/总量', dataIndex: 'totalQuantity', width: 110, render: (_: number, r: Coupon) => renderQuantity(r) },
    { title: '每人限领', dataIndex: 'perLimit', width: 90, render: (v: number) => (v > 0 ? v : '不限') },
    { title: '有效期', dataIndex: 'validType', width: 200, render: (_: string, r: Coupon) => <span style={{ fontSize: 12 }}>{renderValid(r)}</span> },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: CouponTemplateStatus) => <Tag color={STATUS_COLORS[v] as 'green'}>{COUPON_TEMPLATE_STATUS_LABELS[v]}</Tag> },
    createdAtColumn,
    ...(hasOps ? [{
      title: '操作', dataIndex: 'ops', width: 190, fixed: 'right' as const,
      render: (_: unknown, r: Coupon) => (
        <span>
          {canIssue && <Button theme="borderless" size="small" onClick={() => openIssue(r)}>发券</Button>}
          {canEdit && <Button theme="borderless" size="small" onClick={() => openEdit(r)}>编辑</Button>}
          {canDelete && (
            <Popconfirm title="确定要删除该优惠券吗？" onConfirm={() => handleDelete(r.id)}>
              <Button theme="borderless" type="danger" size="small">删除</Button>
            </Popconfirm>
          )}
        </span>
      ),
    }] : []),
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="券名称" value={search.keyword} showClear style={{ width: 180 }}
          onChange={(v) => setSearch((p) => ({ ...p, keyword: v || undefined }))} onEnterPress={handleSearch} />
        <Select placeholder="全部类型" value={search.type} style={{ width: 120 }} showClear
          onChange={(v) => setSearch((p) => ({ ...p, type: v as string | undefined }))} optionList={typeOptions} />
        <Select placeholder="全部状态" value={search.status} style={{ width: 120 }} showClear
          onChange={(v) => setSearch((p) => ({ ...p, status: v as string | undefined }))} optionList={statusOptions} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('member:coupon:create') && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
      </SearchToolbar>

      <ConfigurableTable bordered columns={columns} dataSource={data} loading={loading}
        onRefresh={fetchData} refreshLoading={loading} rowKey="id" size="small"
        pagination={buildPagination(total, fetchData)} empty="暂无优惠券" scroll={{ x: 1200 }} />

      <AppModal title={editing ? '编辑优惠券' : '新增优惠券'} visible={modalVisible} width={560}
        onCancel={() => setModalVisible(false)} onOk={handleSubmit}>
        <Form<FormValues> key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }}
          initValues={initValues() as FormValues} labelPosition="left" labelWidth={110}
          onValueChange={(values) => { if (values.type) setFormType(values.type); if (values.validType) setFormValidType(values.validType); }}>
          <Form.Input field="name" label="券名称" rules={[{ required: true, message: '请输入券名称' }]} maxLength={64} />
          <Form.Select field="type" label="券类型" optionList={typeOptions} style={{ width: '100%' }} rules={[{ required: true }]} />
          <Form.InputNumber field="faceValue" label={formType === 'amount' ? '减免金额(元)' : '折扣百分比(%)'} style={{ width: '100%' }}
            min={formType === 'amount' ? 0.01 : 1} max={formType === 'percent' ? 100 : undefined}
            precision={formType === 'amount' ? 2 : 0}
            placeholder={formType === 'amount' ? '如 10 表示减 10 元' : '如 80 表示 8 折'}
            rules={[{ required: true, message: '请输入面值' }]} />
          {formType === 'percent' && (
            <Form.InputNumber field="maxDiscount" label="最高减免(元)" style={{ width: '100%' }} min={0} precision={2} placeholder="0 或留空表示不限" />
          )}
          <Form.InputNumber field="threshold" label="使用门槛(元)" style={{ width: '100%' }} min={0} precision={2} placeholder="0 表示无门槛" />
          <Form.InputNumber field="totalQuantity" label="发行总量" style={{ width: '100%' }} min={0} placeholder="0 表示不限量" />
          <Form.InputNumber field="perLimit" label="每人限领" style={{ width: '100%' }} min={0} placeholder="0 表示不限" />
          <Form.Select field="validType" label="有效期类型" style={{ width: '100%' }} rules={[{ required: true }]}
            optionList={[{ value: 'fixed', label: '固定日期' }, { value: 'relative', label: '领取后 N 天' }]} />
          {formValidType === 'fixed' ? (
            <>
              <Form.DatePicker field="validStart" label="生效时间" type="dateTime" style={{ width: '100%' }} />
              <Form.DatePicker field="validEnd" label="失效时间" type="dateTime" style={{ width: '100%' }} />
            </>
          ) : (
            <Form.InputNumber field="validDays" label="有效天数" style={{ width: '100%' }} min={1} placeholder="领取后多少天内有效"
              rules={[{ required: true, message: '请输入有效天数' }]} />
          )}
          <Form.Select field="status" label="状态" optionList={statusOptions} style={{ width: '100%' }} rules={[{ required: true }]} />
          <Form.TextArea field="description" label="说明" maxCount={256} />
        </Form>
      </AppModal>

      <AppModal title={`发放优惠券：${issuing?.name ?? ''}`} visible={issueVisible} width={420}
        onCancel={() => setIssueVisible(false)} onOk={handleIssue}>
        <Form key={issuing?.id ?? 'issue'} getFormApi={(api) => { issueFormApi.current = api; }} labelPosition="left" labelWidth={90}>
          <Form.InputNumber field="memberId" label="会员ID" min={1} style={{ width: '100%' }}
            rules={[{ required: true, message: '请输入要发放的会员ID' }]} />
        </Form>
      </AppModal>
    </div>
  );
}
