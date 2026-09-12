import { useMemo } from 'react';
import { Tag, Form, Typography, Row, Col, Space } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { USER_STATUSES, enumValueOf } from '@zenith/shared/core';
import type { CreateRatePlanInput, RatePlan } from '@zenith/shared/open-platform';
import { copyableNoColumn, createdAtColumn, renderEnabledStatusTag } from '@/utils/table-columns';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { ratePlanKeys, useDeleteRatePlans, useRatePlanList, useSaveRatePlan } from '@/hooks/queries/open-platform';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { compactParams } from '@/lib/query';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';

const { Text } = Typography;

const fmtQuota = (n: number) => (n > 0 ? n.toLocaleString() : '不限');

export default function RatePlansPage() {
  const { options: statusOptions } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const canManage = hasPermission('open:rate-plan:manage');

  interface SearchParams { keyword: string; status?: string }
  const defaultSearchParams: SearchParams = { keyword: '', status: undefined };
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: ratePlanKeys.lists });

  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  }), [submittedParams]);
  const listQuery = useRatePlanList({
    page,
    pageSize,
    ...filterQuery,
  });
  const deleteMutation = useDeleteRatePlans();

  const modal = useEditModal<RatePlan, Partial<CreateRatePlanInput>>({
    entityName: '限流套餐',
    save: useSaveRatePlan(),
    defaults: { qpsLimit: 10, dailyQuota: 0, monthlyQuota: 0, isDefault: false, status: 'enabled' },
    // 记录里的 null 描述在表单中视为未填
    toValues: (r) => ({
      code: r.code,
      name: r.name,
      description: r.description ?? undefined,
      qpsLimit: r.qpsLimit,
      dailyQuota: r.dailyQuota,
      monthlyQuota: r.monthlyQuota,
      isDefault: r.isDefault,
      status: r.status,
    }),
  });

  const columns: ColumnProps<RatePlan>[] = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '名称',
      dataIndex: 'name',
      width: 160,
      render: (v: string, r: RatePlan) => (
        <Space spacing={6}>
          {v}
          {r.isDefault && <Tag color="blue" size="small">默认</Tag>}
        </Space>
      ),
    },
    copyableNoColumn('编码', 'code', { width: 160 }),
    { title: 'QPS', dataIndex: 'qpsLimit', width: 100, align: 'right', render: (v: number) => (v > 0 ? `${v}/s` : '不限') },
    { title: '每日配额', dataIndex: 'dailyQuota', width: 120, align: 'right', render: fmtQuota },
    { title: '每月配额', dataIndex: 'monthlyQuota', width: 120, align: 'right', render: fmtQuota },
    { title: '描述', dataIndex: 'description', minWidth: 220, render: (v: string | null) => v ? <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 210 }}>{v}</Text> : <Text type="tertiary">—</Text> },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right' as const,
      render: renderEnabledStatusTag,
    },
    createOperationColumn<RatePlan>({
      width: 150,
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !canManage, onClick: () => modal.openEdit(record) },
        deleteAction({
          hidden: !canManage,
          title: '确定要删除此套餐吗？',
          content: '已被应用绑定的套餐无法删除',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索套餐编码 / 名称" {...bindKeyword('keyword')} />}
        filters={(
          <>
            <StatusSelect
              items={statusOptions}
              {...bind('status')}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={canManage && <CreateButton onClick={modal.openCreate} />}
        actionTitle="套餐操作"
      />

      <ConfigurableTable<RatePlan>
        columns={columns}
        {...listTableProps(listQuery, { empty: '暂无数据', pagination: buildPagination })}
      />

      <AppModal {...modal.modalProps} width={660}>
        <Form key={modal.formKey} {...modal.formProps}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input
                field="code"
                label="套餐编码"
                placeholder="如 free / pro"
                disabled={modal.isEdit}
                extraText={modal.isEdit ? '编码不可修改' : '小写字母开头'}
                rules={[{ required: true, message: '套餐编码不能为空' }]}
              />
            </Col>
            <Col span={12}>
              <Form.Input field="name" label="套餐名称" placeholder="如 免费版" rules={[{ required: true, message: '名称不能为空' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.InputNumber field="qpsLimit" label="QPS" min={0} style={{ width: '100%' }} extraText="0=不限" rules={[{ required: true, message: '必填' }]} />
            </Col>
            <Col span={8}>
              <Form.InputNumber field="dailyQuota" label="每日配额" min={0} style={{ width: '100%' }} extraText="0=不限" rules={[{ required: true, message: '必填' }]} />
            </Col>
            <Col span={8}>
              <Form.InputNumber field="monthlyQuota" label="每月配额" min={0} style={{ width: '100%' }} extraText="0=不限" rules={[{ required: true, message: '必填' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Switch field="isDefault" label="默认套餐" extraText="应用未绑定套餐时回退使用" />
            </Col>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusOptions} rules={[{ required: true, message: '请选择状态' }]} />
            </Col>
          </Row>
          <Form.TextArea field="description" label="描述" placeholder="套餐说明（可选）" rows={2} />
        </Form>
      </AppModal>
    </div>
  );
}
