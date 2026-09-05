import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Toast, Tag, Row, Col, Typography, SideSheet, Button } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { Coupon, CouponType, CouponTemplateStatus, CreateCouponInput } from '@zenith/shared/member';
import { COUPON_TEMPLATE_STATUSES, COUPON_TYPES, COUPON_TYPE_LABELS, COUPON_TEMPLATE_STATUS_LABELS } from '@zenith/shared/member';
import { enumValueOf } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
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
  useDeleteCoupons,
  useIssueCoupon,
  useSaveCoupon,
} from '@/hooks/queries/member-admin';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete as confirmDeleteModal } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';

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
  totalQuantity?: number; perLimit?: number; exchangePoints?: number; validType: 'fixed' | 'relative';
  validStart?: string | Date; validEnd?: string | Date; validDays?: number;
  status: CouponTemplateStatus; description?: string;
}

export default function CouponsPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const issueFormApi = useRef<FormApi | null>(null);
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: {}, listKey: memberAdminKeys.couponLists });

  const [formType, setFormType] = useState<CouponType>('amount');
  const [formValidType, setFormValidType] = useState<'fixed' | 'relative'>('fixed');
  const [formStatus, setFormStatus] = useState<CouponTemplateStatus>('draft');

  const [issueVisible, setIssueVisible] = useState(false);
  const [issuing, setIssuing] = useState<Coupon | null>(null);
  const listQuery = useCouponList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(COUPON_TEMPLATE_STATUSES, submittedParams.status),
    type: enumValueOf(COUPON_TYPES, submittedParams.type),
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const saveMutation = useSaveCoupon();
  const deleteMutation = useDeleteCoupons();
  const issueMutation = useIssueCoupon();

  const couponModal = useEditModal<Coupon, FormValues, Partial<CreateCouponInput>>({
    entityName: '优惠券',
    save: saveMutation,
    defaults: { type: 'amount', validType: 'fixed', status: 'draft', threshold: 0, totalQuantity: 0, perLimit: 0, exchangePoints: 0 },
    toValues: (record) => ({
      name: record.name,
      type: record.type,
      faceValue: record.type === 'amount' ? record.faceValue / 100 : record.faceValue,
      threshold: record.threshold / 100,
      maxDiscount: record.maxDiscount ? record.maxDiscount / 100 : undefined,
      totalQuantity: record.totalQuantity,
      perLimit: record.perLimit,
      exchangePoints: record.exchangePoints ?? 0,
      validType: record.validType,
      validStart: record.validStart ?? undefined,
      validEnd: record.validEnd ?? undefined,
      validDays: record.validDays ?? undefined,
      status: record.status,
      description: record.description ?? undefined,
    }),
    beforeSave: (v) => ({
      name: v.name,
      type: v.type,
      status: v.status,
      description: v.description ?? null,
      faceValue: v.type === 'amount' ? Math.round(v.faceValue * 100) : v.faceValue,
      threshold: Math.round((v.threshold ?? 0) * 100),
      maxDiscount: v.type === 'percent' && v.maxDiscount ? Math.round(v.maxDiscount * 100) : null,
      totalQuantity: v.totalQuantity ?? 0,
      perLimit: v.perLimit ?? 0,
      exchangePoints: v.exchangePoints ?? 0,
      validType: v.validType,
      validStart: v.validType === 'fixed' && v.validStart ? formatDateTimeForApi(v.validStart) : undefined,
      validEnd: v.validType === 'fixed' && v.validEnd ? formatDateTimeForApi(v.validEnd) : undefined,
      validDays: v.validType === 'relative' ? v.validDays ?? null : null,
    }),
    successMessage: ({ isEdit }) => (isEdit ? '已更新' : '已创建'),
    labelWidth: 130,
  });
  const openCreate = () => {
    setFormType('amount');
    setFormValidType('fixed');
    setFormStatus('draft');
    couponModal.openCreate();
  };
  const openEdit = (r: Coupon) => {
    setFormType(r.type);
    setFormValidType(r.validType);
    setFormStatus(r.status);
    couponModal.openEdit(r);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync([id]);
    Toast.success('已删除');
  };

  const confirmDelete = (record: Coupon) => {
    confirmDeleteModal({
      title: '确定要删除该优惠券吗？',
      onOk: () => handleDelete(record.id),
    });
  };

  const openIssue = (r: Coupon) => { setIssuing(r); setIssueVisible(true); };

  // 行内上架/停用：上架时后端校验有效期配置完整性，不完整会拒绝并提示
  const handleToggleStatus = async (r: Coupon) => {
    const next = r.status === 'active' ? 'paused' : 'active';
    await saveMutation.mutateAsync({ id: r.id, values: { status: next } });
    Toast.success(next === 'active' ? '已上架' : '已停用');
  };
  const handleIssue = async () => {
    let values: { memberId: number };
    try { values = (await issueFormApi.current!.validate()) as { memberId: number }; } catch { abortSubmit('validation'); }
    await issueMutation.mutateAsync({ params: { id: issuing!.id }, body: { memberId: values.memberId } });
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
    { title: '面值', dataIndex: 'faceValue', width: 100, align: 'right', render: (_: number, r: Coupon) => renderFace(r) },
    { title: '门槛', dataIndex: 'threshold', width: 110, align: 'right', render: renderThreshold },
    { title: '已发/总量', dataIndex: 'totalQuantity', width: 110, align: 'right', render: (_: number, r: Coupon) => (
      r.issuedQuantity > 0
        ? <Typography.Text link onClick={() => navigate(`/member/coupon-records?couponId=${r.id}`)}>{renderQuantity(r)}</Typography.Text>
        : renderQuantity(r)
    ) },
    { title: '每人限领', dataIndex: 'perLimit', width: 90, align: 'right', render: (v: number) => (v > 0 ? v : '不限') },
    { title: '兑换积分', dataIndex: 'exchangePoints', width: 90, align: 'right', render: (v?: number) => (v && v > 0 ? v : '-') },
    { title: '有效期', dataIndex: 'validType', minWidth: 200, render: (_: string, r: Coupon) => <span style={{ fontSize: 12 }}>{renderValid(r)}</span> },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: CouponTemplateStatus) => <Tag color={STATUS_COLORS[v] as 'green'}>{COUPON_TEMPLATE_STATUS_LABELS[v]}</Tag> },
    createdAtColumn,
    ...(hasOps ? [
      createOperationColumn<Coupon>({
        width: 240,
        desktopInlineKeys: ['issue', 'toggle', 'edit'],
        actions: (record) => [
          { key: 'issue', label: '发券', hidden: !canIssue || record.status !== 'active', onClick: () => openIssue(record) },
          {
            key: 'toggle',
            label: record.status === 'active' ? '停用' : '上架',
            hidden: !canEdit || record.status === 'expired',
            onClick: () => void handleToggleStatus(record),
          },
          { key: 'edit', label: '编辑', hidden: !canEdit, onClick: () => openEdit(record) },
          { key: 'delete', label: '删除', danger: true, hidden: !canDelete, onClick: () => confirmDelete(record) },
        ],
      }),
    ] : []),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="券名称" value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} width={180} />
  );

  const renderTypeFilter = () => (
    <FilterSelect
      placeholder="全部类型"
      items={typeOptions}
      value={draftParams.type}
      onChange={(v) => setDraftParams((p) => ({ ...p, type: v as string | undefined }))}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={statusOptions}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const renderCreateButton = () => hasPermission('member:coupon:create') ? (
    <CreateButton onClick={openCreate} />
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
        pagination={buildPagination(total)} empty="暂无优惠券" />

      <SideSheet
        title={couponModal.modalProps.title}
        visible={couponModal.modalProps.visible}
        onCancel={couponModal.modalProps.onCancel}
        width={700}
        closeOnEsc
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="tertiary" onClick={couponModal.modalProps.onCancel}>取消</Button>
            <Button
              type="primary"
              theme="solid"
              loading={couponModal.modalProps.okButtonProps.loading}
              disabled={couponModal.modalProps.okButtonProps.disabled}
              onClick={() => void couponModal.modalProps.onOk()}
            >
              确定
            </Button>
          </div>
        )}
      >
        <Form key={couponModal.formKey} {...couponModal.formProps}
          onValueChange={(values) => { if (values.type) setFormType(values.type as CouponType); if (values.validType) setFormValidType(values.validType as 'fixed' | 'relative'); if (values.status) setFormStatus(values.status as CouponTemplateStatus); }}>
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
              <Form.InputNumber field="exchangePoints" label="兑换积分" style={{ width: '100%' }} min={0} precision={0}
                placeholder="0 表示不可积分兑换" extraText="配置后会员可在前台用积分兑换本券" />
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
                <Form.DatePicker field="validStart" label="生效时间" type="dateTime" style={{ width: '100%' }}
                  rules={formStatus === 'active' ? [{ required: true, message: '生效中的券必须配置生效时间' }] : []}
                  extraText={formStatus === 'active' ? undefined : '草稿可暂不配置，上架时必填'} />
              </Col>
              <Col span={12}>
                <Form.DatePicker field="validEnd" label="失效时间" type="dateTime" style={{ width: '100%' }}
                  rules={formStatus === 'active' ? [{ required: true, message: '生效中的券必须配置失效时间' }] : []} />
              </Col>
            </Row>
          )}
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="description" label="说明" maxCount={256} />
            </Col>
          </Row>
        </Form>
      </SideSheet>

      <AppModal title={`发放优惠券：${issuing?.name ?? ''}`} visible={issueVisible} width={420}
        onCancel={() => setIssueVisible(false)} onOk={handleIssue}>
        <Form key={issuing?.id ?? 'issue'} getFormApi={(api) => { issueFormApi.current = api; }} labelPosition="left" labelWidth={90}>
          <MemberSelect field="memberId" required />
        </Form>
      </AppModal>
    </div>
  );
}
