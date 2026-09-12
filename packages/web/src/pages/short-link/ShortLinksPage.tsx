import { useState, useMemo } from 'react';
import ModalFooter from '@/components/ModalFooter';
import { Col, Collapse, Form, Modal, Row, SideSheet, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { QRCodeSVG } from 'qrcode.react';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { batchStatusHandler, confirmAndDelete, deleteAction, ListSearchToolbar, listTableProps, useRowSelection, useStatusToggle } from '@/components/list-page';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { BatchDeleteButton, BatchStatusButtons, CreateButton } from '@/components/toolbar-controls';
import { copyableNoColumn, createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { formatDateTimeForApi, formatDateTimeRangeForApi } from '@/utils/date';
import {
  shortLinkKeys, useBatchUpdateShortLinkStatus, useDeleteShortLinks,
  useSaveShortLink, useShortLinkDetail, useShortLinkList,
} from '@/hooks/queries/short-links';
import { USER_STATUSES, enumValueOf } from '@zenith/shared/core';
import {
  SHORT_LINK_BIZ_TYPES, SHORT_LINK_BIZ_TYPE_LABELS, SHORT_LINK_BIZ_TYPE_OPTIONS,
  SHORT_LINK_REDIRECT_TYPE_OPTIONS,
} from '@zenith/shared/short-link';
import type { CreateShortLinkInput, ShortLink } from '@zenith/shared/short-link';
import ShortLinkStatsDrawer from './ShortLinkStatsDrawer';
import { compactParams } from '@/lib/query';

const { Text } = Typography;

interface SearchParams {
  keyword: string;
  status?: string;
  bizType?: string;
  timeRange: [Date, Date] | null;
}

const defaultSearchParams: SearchParams = { keyword: '', status: undefined, bizType: undefined, timeRange: null };

/** 短链表单值：`expiresAt` 在表单里是 Date，提交前由 beforeSave 转成接口格式；记录里的 null 在表单中归一为空串 / 未填 */
interface ShortLinkFormValues extends Partial<Omit<CreateShortLinkInput, 'expiresAt'>> {
  expiresAt?: Date | string | null;
}

/** 表单值 → 提交载荷：空串统一转 null，DatePicker 值转 API 字符串 */
function normalizePayload(values: ShortLinkFormValues, isEdit: boolean): Partial<CreateShortLinkInput> {
  const nullable = (v: string | null | undefined) => (v === '' || v === undefined ? null : v);
  return {
    targetUrl: values.targetUrl,
    ...(isEdit ? {} : { code: values.code || undefined }),
    title: nullable(values.title),
    redirectType: values.redirectType,
    status: values.status,
    expiresAt: values.expiresAt ? formatDateTimeForApi(values.expiresAt) : null,
    maxVisits: typeof values.maxVisits === 'number' ? values.maxVisits : null,
    password: nullable(values.password),
    utmSource: nullable(values.utmSource),
    utmMedium: nullable(values.utmMedium),
    utmCampaign: nullable(values.utmCampaign),
    utmTerm: nullable(values.utmTerm),
    utmContent: nullable(values.utmContent),
    remark: nullable(values.remark),
  };
}

export default function ShortLinksPage() {
  const { hasPermission } = usePermission();
  const { selectedRowKeys, clear: clearSelection, rowSelection } = useRowSelection();
  const [qrLink, setQrLink] = useState<ShortLink | null>(null);
  const [statsLink, setStatsLink] = useState<ShortLink | null>(null);

  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({
    defaults: defaultSearchParams,
    listKey: shortLinkKeys.lists,
    onSearch: clearSelection,
    onReset: clearSelection,
  });

  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
    bizType: enumValueOf(SHORT_LINK_BIZ_TYPES, submittedParams.bizType),
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  }), [submittedParams]);
  const listQuery = useShortLinkList({ page, pageSize, ...filterQuery });

  const modal = useEditModal<ShortLink, ShortLinkFormValues, Partial<CreateShortLinkInput>>({
    entityName: '短链',
    save: useSaveShortLink(),
    useDetail: useShortLinkDetail,
    defaults: { status: 'enabled', redirectType: '302' },
    toValues: (r) => ({
      targetUrl: r.targetUrl,
      code: r.code,
      title: r.title ?? '',
      redirectType: r.redirectType,
      status: r.status,
      expiresAt: r.expiresAt ?? undefined,
      maxVisits: r.maxVisits ?? undefined,
      password: r.password ?? '',
      utmSource: r.utmSource ?? '',
      utmMedium: r.utmMedium ?? '',
      utmCampaign: r.utmCampaign ?? '',
      utmTerm: r.utmTerm ?? '',
      utmContent: r.utmContent ?? '',
      remark: r.remark ?? '',
    }),
    beforeSave: (values, ctx) => normalizePayload(values, ctx.isEdit),
    labelWidth: 110,
  });

  const toggleStatusMutation = useSaveShortLink();
  const deleteMutation = useDeleteShortLinks();
  const batchStatusMutation = useBatchUpdateShortLinkStatus();
  const status = useStatusToggle<ShortLink>({
    toggle: (record, enabled) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({
      title: '确认停用',
      content: `停用后短链「${record.code}」将无法访问，确认停用？`,
    }),
    disabled: !hasPermission('shortlink:link:update'),
  });

  // 编辑已配置 UTM 的记录时，折叠面板默认展开
  const editing = modal.editing;
  const editingHasUtm = Boolean(
    editing && (editing.utmSource || editing.utmMedium || editing.utmCampaign || editing.utmTerm || editing.utmContent),
  );

  const { items: statusItems, options: statusOptions } = useDictItems('common_status');


  function handleBatchDelete() {
    confirmAndDelete({
      title: `确认删除选中的 ${selectedRowKeys.length} 条短链？`,
      content: '删除后短链立即失效且不可恢复，点击明细一并清除。',
      run: () => deleteMutation.mutateAsync(selectedRowKeys),
      successMessage: '批量删除成功',
      onDeleted: clearSelection,
    });
  }

  // 批量启用直接执行；批量禁用会让短链立即不可访问，需要确认
  const handleBatchStatus = batchStatusHandler({
    selectedRowKeys,
    clearSelection,
    run: (ids, status) => batchStatusMutation.mutateAsync({ body: { ids, status } }),
    disableLabel: '禁用',
    entity: '条短链',
    confirmContent: (_status, count) => `禁用后选中的 ${count} 条短链将无法访问，确认禁用？`,
  });

  const columns: ColumnProps<ShortLink>[] = [
    copyableNoColumn('短链', 'code', {
      width: 170,
      displayText: (v) => `/s/${v}`,
      copyContent: (_v, record) => record.shortUrl,
    }),
    { title: '标题', dataIndex: 'title', width: 160, render: renderEllipsis },
    { title: '目标地址', dataIndex: 'targetUrl', minWidth: 240, render: renderEllipsis },
    {
      title: '来源', dataIndex: 'bizType', width: 100,
      render: (v: ShortLink['bizType']) => (
        <Tag color={v === 'custom' ? 'blue' : 'cyan'} size="small">{SHORT_LINK_BIZ_TYPE_LABELS[v] ?? v}</Tag>
      ),
    },
    {
      title: '访问量', dataIndex: 'totalPv', width: 90,
      render: (v: number, record: ShortLink) => (
        <Text type={record.expired ? 'tertiary' : undefined}>{v}</Text>
      ),
    },
    dateTimeColumn('有效期', 'expiresAt', { empty: '永久' }),
    createdAtColumn,
    status.column(),
    createOperationColumn<ShortLink>({
      width: 180,
      desktopInlineKeys: ['stats', 'edit'],
      actions: (record) => [
        ...(hasPermission('shortlink:stats:view') ? [{
          key: 'stats', label: '统计', onClick: () => setStatsLink(record),
        }] : []),
        ...(hasPermission('shortlink:link:update') ? [{
          key: 'edit', label: '编辑', onClick: () => modal.openEdit(record),
        }] : []),
        { key: 'qrcode', label: '二维码', onClick: () => setQrLink(record) },
        deleteAction({
          hidden: !hasPermission('shortlink:link:delete'),
          title: `确定要删除短链「${record.code}」吗？`,
          content: '删除后短链立即失效且不可恢复',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  const renderBatchButtons = () => selectedRowKeys.length > 0 ? (
    <>
      {hasPermission('shortlink:link:update') && (
        <BatchStatusButtons count={selectedRowKeys.length} onChange={handleBatchStatus} disableLabel="批量禁用" />
      )}
      {hasPermission('shortlink:link:delete') && (
        <BatchDeleteButton count={selectedRowKeys.length} onClick={handleBatchDelete} />
      )}
    </>
  ) : null;

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <KeywordInput
            placeholder="搜索短码 / 标题 / 目标地址..."
            {...bindKeyword('keyword')}
          />
        )}
        filters={<>
          <StatusSelect
            items={statusItems}
            {...bind('status')}
          />
          <FilterSelect
            items={SHORT_LINK_BIZ_TYPE_OPTIONS}
            placeholder="全部来源"
            {...bind('bizType')}
          />
          <DateRangeFilter
            {...bind('timeRange')}
          />
        </>}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('shortlink:link:create')
            ? <CreateButton onClick={modal.openCreate} /> : null
        )}
        actions={<>
          {renderBatchButtons()}
          <ExportButton entity="shortlink.links" query={filterQuery} permission="shortlink:link:export" />
        </>}
        mobileActions={<>
          {renderBatchButtons()}
          <ExportButton entity="shortlink.links" query={filterQuery} variant="flat" permission="shortlink:link:export" />
        </>}
        filterTitle="筛选条件"
      />

      <ConfigurableTable<ShortLink>
        columns={columns}
        empty="暂无数据"
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          rowSelection,
        })}
      />

      {/* 新增 / 编辑 */}
      <SideSheet
        title={modal.modalProps.title}
        visible={modal.visible}
        onCancel={modal.close}
        closeOnEsc
        width={660}
        footer={<ModalFooter {...modal.footerProps} okText="保存" />}
      >
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Form.Input
              field="targetUrl" label="目标地址" placeholder="https://example.com/landing"
              rules={[
                { required: true, message: '目标地址不能为空' },
                { validator: (_r, v: string) => !v || /^https?:\/\//.test(v), message: '仅支持 http/https 地址' },
              ]}
            />
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input
                  field="code" label="自定义短码" placeholder="留空自动生成"
                  disabled={modal.isEdit}
                  extraText={modal.isEdit ? '短码一经分发不可修改' : '4-32 位字母 / 数字 / - / _'}
                />
              </Col>
              <Col span={12}>
                <Form.Input field="title" label="标题" placeholder="便于识别的名称" />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select
                  field="redirectType" label="跳转方式" style={{ width: '100%' }}
                  optionList={SHORT_LINK_REDIRECT_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  rules={[{ required: true, message: '请选择跳转方式' }]}
                  extraText="301 会被浏览器缓存，改址与统计不生效，营销场景建议 302"
                />
              </Col>
              <Col span={12}>
                <Form.Select
                  field="status" label="状态" style={{ width: '100%' }}
                  optionList={statusOptions}
                  rules={[{ required: true, message: '请选择状态' }]}
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.DatePicker
                  field="expiresAt" label="过期时间" type="dateTime"
                  style={{ width: '100%' }} placeholder="留空永久有效" showClear
                />
              </Col>
              <Col span={12}>
                <Form.InputNumber
                  field="maxVisits" label="访问上限" style={{ width: '100%' }}
                  placeholder="留空不限次数" min={1} showClear
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="password" label="访问密码" placeholder="留空无需密码，至少 4 位" />
              </Col>
            </Row>
            {/* UTM 低频选填：默认折叠压缩弹窗高度；编辑已填 UTM 的记录时自动展开。
                keepDOM 保证折叠时字段仍注册在表单中，提交不丢值 */}
            <Collapse keepDOM key={modal.formKey} defaultActiveKey={editingHasUtm ? ['utm'] : []} style={{ marginBottom: 12 }}>
              <Collapse.Panel header="UTM 跟踪参数（选填，跳转时自动拼接）" itemKey="utm">
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Input field="utmSource" label="utm_source" placeholder="流量来源，如 sms" />
                  </Col>
                  <Col span={12}>
                    <Form.Input field="utmMedium" label="utm_medium" placeholder="媒介，如 shortlink" />
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Input field="utmCampaign" label="utm_campaign" placeholder="活动名称" />
                  </Col>
                  <Col span={12}>
                    <Form.Input field="utmTerm" label="utm_term" placeholder="关键词" />
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Input field="utmContent" label="utm_content" placeholder="内容标识" />
                  </Col>
                </Row>
              </Collapse.Panel>
            </Collapse>
            <Form.TextArea field="remark" label="备注" placeholder="选填" rows={2} maxCount={256} />
          </Form>
        </Spin>
      </SideSheet>

      {/* 二维码 */}
      <Modal
        title="短链二维码"
        visible={qrLink !== null}
        onCancel={() => setQrLink(null)}
        footer={null}
        closeOnEsc
        width={360}
      >
        {qrLink && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '8px 0 20px' }}>
            <QRCodeSVG value={qrLink.shortUrl} size={200} marginSize={2} />
            <Text copyable={{ content: qrLink.shortUrl }} style={{ wordBreak: 'break-all', textAlign: 'center' }}>
              {qrLink.shortUrl}
            </Text>
          </div>
        )}
      </Modal>

      {/* 访问统计 */}
      <ShortLinkStatsDrawer link={statsLink} onClose={() => setStatsLink(null)} />
    </div>
  );
}
