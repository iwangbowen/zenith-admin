import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, Form, Toast, Tag, Modal, Row, Col } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw, Plus } from 'lucide-react';
import type { Coupon, CouponType, CouponTemplateStatus } from '@zenith/shared';
import { COUPON_TYPE_LABELS, COUPON_TEMPLATE_STATUS_LABELS } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { MemberSelect } from '@/components/MemberSelect';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { formatDateTimeForApi } from '@/utils/date';
import {
  memberAdminKeys,
  useCouponList,
  useDeleteCoupon,
  useIssueCoupon,
  useSaveCoupon,
} from '@/hooks/queries/member-admin';

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
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi<FormValues> | null>(null);
  const issueFormApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>({});
  const [submittedParams, setSubmittedParams] = useState<SearchParams>({});

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [formType, setFormType] = useState<CouponType>('amount');
  const [formValidType, setFormValidType] = useState<'fixed' | 'relative'>('fixed');

  const [issueVisible, setIssueVisible] = useState(false);
  const [issuing, setIssuing] = useState<Coupon | null>(null);
  const listQuery = useCouponList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    type: submittedParams.type || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const saveMutation = useSaveCoupon();
  const deleteMutation = useDeleteCoupon();
  const issueMutation = useIssueCoupon();

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: memberAdminKeys.couponLists });
  };
  const handleReset = () => {
    setDraftParams({});
    setSubmittedParams({});
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: memberAdminKeys.couponLists });
  };

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
    await saveMutation.mutateAsync({ id: editing?.id, values: payload });
    Toast.success(editing ? '已更新' : '已创建');
    setModalVisible(false);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('已删除');
  };

  const confirmDelete = (record: Coupon) => {
    Modal.confirm({
      title: '确定要删除该优惠券吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: () => handleDelete(record.id),
    });
  };

  const openIssue = (r: Coupon) => { setIssuing(r); setIssueVisible(true); };
  const handleIssue = async () => {
    let values: { memberId: number };
    try { values = (await issueFormApi.current!.validate()) as { memberId: number }; } catch { throw new Error('validation'); }
    await issueMutation.mutateAsync({ id: issuing!.id, memberId: values.memberId });
    Toast.success('发放成功');
    setIssueVisible(false);
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
    ...(hasOps ? [
      createOperationColumn<Coupon>({
        width: 190,
        desktopInlineKeys: ['issue', 'edit', 'delete'],
        actions: (record) => [
          { key: 'issue', label: '发券', hidden: !canIssue, onClick: () => openIssue(record) },
          { key: 'edit', label: '编辑', hidden: !canEdit, onClick: () => openEdit(record) },
          { key: 'delete', label: '删除', danger: true, hidden: !canDelete, onClick: () => confirmDelete(record) },
        ],
      }),
    ] : []),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="券名称"
      value={draftParams.keyword}
      showClear
      style={{ width: 180 }}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v || undefined }))}
      onEnterPress={handleSearch}
    />
  );

  const renderTypeFilter = () => (
    <Select
      placeholder="全部类型"
      value={draftParams.type}
      style={{ width: 120 }}
      showClear
      onChange={(v) => setDraftParams((p) => ({ ...p, type: v as string | undefined }))}
      optionList={typeOptions}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={draftParams.status}
      style={{ width: 120 }}
      showClear
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v as string | undefined }))}
      optionList={statusOptions}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => hasPermission('member:coupon:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderTypeFilter()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
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
        mobileFilters={(
          <>
            {renderTypeFilter()}
            {renderStatusFilter()}
          </>
        )}
        filterTitle="优惠券筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable bordered columns={columns} dataSource={data} loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} rowKey="id" size="small"
        pagination={buildPagination(total)} empty="暂无优惠券" scroll={{ x: 1200 }} />

      <AppModal title={editing ? '编辑优惠券' : '新增优惠券'} visible={modalVisible} width={700}
        onCancel={() => setModalVisible(false)} onOk={handleSubmit}>
        <Form<FormValues> key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }}
          initValues={initValues() as FormValues} labelPosition="left" labelWidth={130}
          onValueChange={(values) => { if (values.type) setFormType(values.type); if (values.validType) setFormValidType(values.validType); }}>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Input field="name" label="券名称" rules={[{ required: true, message: '请输入券名称' }]} maxLength={64} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="type" label="券类型" optionList={typeOptions} style={{ width: '100%' }} rules={[{ required: true }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="status" label="状态" optionList={statusOptions} style={{ width: '100%' }} rules={[{ required: true }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.InputNumber field="faceValue" label={formType === 'amount' ? '减免金额(元)' : '折扣百分比(%)'} style={{ width: '100%' }}
                min={formType === 'amount' ? 0.01 : 1} max={formType === 'percent' ? 100 : undefined}
                precision={formType === 'amount' ? 2 : 0}
                placeholder={formType === 'amount' ? '如 10 表示减 10 元' : '如 80 表示 8 折'}
                rules={[{ required: true, message: '请输入面值' }]} />
            </Col>
            <Col span={12}>
              <Form.InputNumber field="threshold" label="使用门槛(元)" style={{ width: '100%' }} min={0} precision={2} placeholder="0 表示无门槛" />
            </Col>
          </Row>
          {formType === 'percent' && (
            <Row gutter={16}>
              <Col span={12}>
                <Form.InputNumber field="maxDiscount" label="最高减免(元)" style={{ width: '100%' }} min={0} precision={2} placeholder="0 或留空表示不限" />
              </Col>
            </Row>
          )}
          <Row gutter={16}>
            <Col span={12}>
              <Form.InputNumber field="totalQuantity" label="发行总量" style={{ width: '100%' }} min={0} placeholder="0 表示不限量" />
            </Col>
            <Col span={12}>
              <Form.InputNumber field="perLimit" label="每人限领" style={{ width: '100%' }} min={0} placeholder="0 表示不限" />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="validType" label="有效期类型" style={{ width: '100%' }} rules={[{ required: true }]}
                optionList={[{ value: 'fixed', label: '固定日期' }, { value: 'relative', label: '领取后 N 天' }]} />
            </Col>
            {formValidType === 'relative' && (
              <Col span={12}>
                <Form.InputNumber field="validDays" label="有效天数" style={{ width: '100%' }} min={1} placeholder="领取后多少天内有效"
                  rules={[{ required: true, message: '请输入有效天数' }]} />
              </Col>
            )}
          </Row>
          {formValidType === 'fixed' && (
            <Row gutter={16}>
              <Col span={12}>
                <Form.DatePicker field="validStart" label="生效时间" type="dateTime" style={{ width: '100%' }} />
              </Col>
              <Col span={12}>
                <Form.DatePicker field="validEnd" label="失效时间" type="dateTime" style={{ width: '100%' }} />
              </Col>
            </Row>
          )}
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="description" label="说明" maxCount={256} />
            </Col>
          </Row>
        </Form>
      </AppModal>

      <AppModal title={`发放优惠券：${issuing?.name ?? ''}`} visible={issueVisible} width={420}
        onCancel={() => setIssueVisible(false)} onOk={handleIssue}>
        <Form key={issuing?.id ?? 'issue'} getFormApi={(api) => { issueFormApi.current = api; }} labelPosition="left" labelWidth={90}>
          <MemberSelect field="memberId" required />
        </Form>
      </AppModal>
    </div>
  );
}
