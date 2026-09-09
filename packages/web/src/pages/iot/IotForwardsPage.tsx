import { useMemo, useState } from 'react';
import { Button, Form, SideSheet, Spin, TabPane, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { CreateButton } from '@/components/toolbar-controls';
import AppModal from '@/components/AppModal';
import { EMPTY_PLACEHOLDER, createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useDictItems } from '@/hooks/useDictItems';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { USER_STATUSES, enumValueOf } from '@zenith/shared/core';
import {
  IOT_FORWARD_SOURCES, IOT_FORWARD_SOURCE_LABELS, IOT_FORWARD_SOURCE_OPTIONS, IOT_FORWARD_STATUSES, IOT_FORWARD_STATUS_OPTIONS,
} from '@zenith/shared/iot';
import type { CreateIotForwardRuleInput, IotForwardLog, IotForwardRule } from '@zenith/shared/iot';
import { useIotGroupOptions, useIotProductOptions } from './components/IotSelectors';
import { IotEnabledTag, IotSuccessTag } from './components/IotStatus';
import { jsonObjectToText, parseJsonObjectInput } from './iot-form-utils';
import {
  iotForwardRuleKeys, useDeleteIotForwardRules, useIotForwardLogList,
  useIotForwardRuleList, useSaveIotForwardRule,
} from '@/hooks/queries/iot-forwards';

const { Text } = Typography;

// ─── 流转规则 Tab ─────────────────────────────────────────────────────────────
interface ForwardSearchParams {
  keyword: string;
  source?: string;
  status?: string;
}

const defaultSearch: ForwardSearchParams = { keyword: '', source: undefined, status: '' };

/** 流转规则表单值：请求头以 JSON 文本编辑，提交前由 beforeSave 解析；密钥留空表示不变更 */
interface ForwardRuleFormValues extends Partial<Omit<CreateIotForwardRuleInput, 'headers'>> {
  headersText?: string;
}

function ForwardRulesTab({ onShowLogs }: Readonly<{ onShowLogs: (rule: IotForwardRule) => void }>) {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<ForwardSearchParams>({ defaults: defaultSearch, listKey: iotForwardRuleKeys.lists });

  const listQuery = useIotForwardRuleList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    source: enumValueOf(IOT_FORWARD_SOURCES, submittedParams.source),
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  });
  const { items: statusItems } = useDictItems('common_status');

  const modal = useEditModal<IotForwardRule, ForwardRuleFormValues, Partial<CreateIotForwardRuleInput>>({
    entityName: '流转规则',
    save: useSaveIotForwardRule(),
    toValues: (r) => ({
      name: r.name,
      source: r.source,
      productId: r.productId,
      groupId: r.groupId,
      url: r.url,
      secret: '',
      headersText: jsonObjectToText(r.headers),
      status: r.status,
    }),
    defaults: { source: 'telemetry', status: 'enabled', secret: '', headersText: '' },
    beforeSave: (values, { isEdit }) => {
      const headers = parseJsonObjectInput({ text: values.headersText, label: '自定义请求头', empty: 'null', toast: 'warning', objectMessage: '自定义请求头需为 JSON 对象，如 {"X-Token":"..."}', errorMessage: 'invalid headers' }) as Record<string, string> | null;
      const secret = values.secret?.trim();
      return {
        name: values.name,
        ...(isEdit ? {} : { source: values.source }),
        productId: values.productId ?? null,
        groupId: values.groupId ?? null,
        url: values.url,
        // 编辑时留空 = 不变更密钥；填写 = 覆盖
        ...(secret ? { secret } : (isEdit ? {} : { secret: null })),
        headers,
        status: values.status,
      };
    },
    labelWidth: 110,
  });

  const deleteMutation = useDeleteIotForwardRules();

  const columns: ColumnProps<IotForwardRule>[] = [
    {
      title: '规则名称', dataIndex: 'name', minWidth: 170,
      render: (v: string) => renderEllipsis(v),
    },
    {
      title: '数据源', dataIndex: 'source', width: 100,
      render: (v: IotForwardRule['source']) => IOT_FORWARD_SOURCE_LABELS[v],
    },
    {
      title: '目的地', dataIndex: 'url', width: 250,
      render: (v: string) => renderEllipsis(v),
    },
    {
      title: '过滤范围', width: 180,
      render: (_: unknown, r: IotForwardRule) => {
        const parts = [
          r.productName ? `产品：${r.productName}` : null,
          r.groupName ? `分组：${r.groupName}` : null,
        ].filter(Boolean);
        return parts.length > 0 ? renderEllipsis(parts.join('；')) : '全部设备';
      },
    },
    {
      title: '签名', dataIndex: 'hasSecret', width: 90,
      render: (v: boolean) => v ? <Tag size="small" color="blue">已配置</Tag> : EMPTY_PLACEHOLDER,
    },
    {
      title: '近 24h', dataIndex: 'recentDeliveryCount', width: 90, align: 'right',
      render: (v: number, r: IotForwardRule) => v > 0
        ? <Button theme="borderless" size="small" onClick={() => onShowLogs(r)}>{v} 次</Button>
        : EMPTY_PLACEHOLDER,
    },
    {
      title: '连续失败', dataIndex: 'consecutiveFailures', width: 110, align: 'right',
      render: (v: number, r: IotForwardRule) => {
        if (r.autoDisabledAt) return <Tag size="small" color="red">已自动停用</Tag>;
        return v > 0 ? <Text type="warning">{v} 次</Text> : EMPTY_PLACEHOLDER;
      },
    },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (v: IotForwardRule['status']) => <IotEnabledTag status={v} />,
    },
    createOperationColumn<IotForwardRule>({
      width: 240,
      actions: (record) => [
        { key: 'logs', label: '投递日志', onClick: () => onShowLogs(record) },
        ...(hasPermission('iot:forward:update') ? [{
          key: 'edit', label: '编辑', onClick: () => modal.openEdit(record),
        }] : []),
        deleteAction({
          hidden: !hasPermission('iot:forward:delete'),
          title: `确定要删除流转规则「${record.name}」吗？`,
          content: '投递日志将一并删除',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  return (
    <>
      <ListSearchToolbar
        keyword={(
          <KeywordInput
            placeholder="搜索规则名称..."
            {...bindKeyword('keyword')}
          />
        )}
        filters={<>
          <FilterSelect
            placeholder="全部数据源"
            items={IOT_FORWARD_SOURCE_OPTIONS}
            {...bind('source')}
            width={140}
          />
          <StatusSelect
            items={statusItems}
            {...bind('status')}
          />
        </>}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('iot:forward:create')
            ? <CreateButton onClick={modal.openCreate}>新增规则</CreateButton> : null
        )}
        filterTitle="筛选条件"
      />
      <ConfigurableTable<IotForwardRule>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无流转规则，点击「新增规则」创建第一条' })}
      />

      <AppModal {...modal.modalProps} width={640}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <ForwardFormBody isEdit={modal.isEdit} />
          </Form>
        </Spin>
      </AppModal>
    </>
  );
}

function ForwardFormBody({ isEdit }: Readonly<{ isEdit: boolean }>) {
  const { options: productOptions } = useIotProductOptions();
  const { options: groupOptions } = useIotGroupOptions();
  const { items: statusItems } = useDictItems('common_status');

  return (
    <>
      <Form.Input field="name" label="规则名称" placeholder="如：告警推送到运维平台"
        rules={[{ required: true, message: '规则名称不能为空' }]} />
      <Form.RadioGroup field="source" label="数据源" disabled={isEdit}
        extraText={isEdit ? '数据源不可变更' : undefined}>
        {IOT_FORWARD_SOURCE_OPTIONS.map((o) => (
          <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>
        ))}
      </Form.RadioGroup>
      <Form.Select
        field="productId" label="过滤产品" placeholder="不限（全部产品）" showClear style={{ width: '100%' }}
        optionList={productOptions}
      />
      <Form.Select
        field="groupId" label="过滤分组" placeholder="不限（全部分组）" showClear style={{ width: '100%' }}
        optionList={groupOptions}
      />
      <Form.Input field="url" label="目的地 URL" placeholder="https://example.com/hooks/iot"
        rules={[{ required: true, message: '目的地不能为空' }]}
        extraText="HTTP POST 推送；不允许本机或内网地址" />
      <Form.Input field="secret" label="签名密钥" mode="password"
        placeholder={isEdit ? '留空保持不变' : '可选；至少 8 位'}
        extraText="配置后携带 X-Iot-Signature = hex(HMAC-SHA256(secret, body))" />
      <Form.Input field="headersText" label="自定义请求头" placeholder='JSON 对象（可空），如 {"X-Token":"..."}' />
      <Form.RadioGroup field="status" label="状态">
        {statusItems.map((o) => (
          <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>
        ))}
      </Form.RadioGroup>
    </>
  );
}

// ─── 投递日志 Tab ─────────────────────────────────────────────────────────────
function ForwardLogsTab({ filterRule, onClearFilter }: Readonly<{
  filterRule: IotForwardRule | null;
  onClearFilter: () => void;
}>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [detailLog, setDetailLog] = useState<IotForwardLog | null>(null);

  const listQuery = useIotForwardLogList({
    page,
    pageSize,
    ruleId: filterRule?.id,
    status: enumValueOf(IOT_FORWARD_STATUSES, statusFilter),
  });
  const columns: ColumnProps<IotForwardLog>[] = [
    dateTimeColumn<IotForwardLog>('投递时间', 'createdAt'),
    {
      title: '规则', dataIndex: 'ruleName', width: 170,
      render: (v: string) => renderEllipsis(v),
    },
    {
      title: '数据源', dataIndex: 'source', width: 100,
      render: (v: IotForwardLog['source']) => IOT_FORWARD_SOURCE_LABELS[v],
    },
    {
      title: 'HTTP', dataIndex: 'responseStatus', width: 80, align: 'right',
      render: (v: number | null) => v ?? EMPTY_PLACEHOLDER,
    },
    {
      title: '耗时', dataIndex: 'durationMs', width: 90, align: 'right',
      render: (v: number | null) => v != null ? `${v}ms` : EMPTY_PLACEHOLDER,
    },
    {
      title: '错误信息', dataIndex: 'errorMessage', minWidth: 240,
      render: (v: string | null) => v ? renderEllipsis(v) : EMPTY_PLACEHOLDER,
    },
    {
      title: '结果', dataIndex: 'status', width: 80, fixed: 'right',
      render: (v: IotForwardLog['status']) => <IotSuccessTag success={v === 'succeeded'} />,
    },
    createOperationColumn<IotForwardLog>({
      width: 100,
      actions: (record) => [
        { key: 'detail', label: '载荷', onClick: () => setDetailLog(record) },
      ],
    }),
  ];

  return (
    <>
      <SearchToolbar
        primary={<>
          {filterRule && (
            <Tag closable onClose={onClearFilter} color="blue">
              规则：{filterRule.name}
            </Tag>
          )}
          <FilterSelect
            placeholder="全部结果"
            items={IOT_FORWARD_STATUS_OPTIONS}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
          />
        </>}
      />
      <ConfigurableTable<IotForwardLog>
        columns={columns}
        {...listTableProps(listQuery, {
          empty: '暂无投递日志',
          pagination: (total) => ({
            currentPage: page,
            pageSize,
            total,
            onPageChange: setPage,
            onPageSizeChange: (size) => { setPageSize(size); setPage(1); },
          }),
        })}
      />

      <SideSheet
        title="投递载荷"
        visible={detailLog !== null}
        onCancel={() => setDetailLog(null)}
        width={520}
      >
        {detailLog && (
          <pre style={{
            margin: 0, padding: 12, borderRadius: 'var(--semi-border-radius-medium)', fontSize: 12,
            background: 'var(--semi-color-fill-0)', overflow: 'auto',
          }}>{JSON.stringify(detailLog.payload, null, 2)}</pre>
        )}
      </SideSheet>
    </>
  );
}

// ─── 页面 ─────────────────────────────────────────────────────────────────────
const FORWARD_TABS = ['rules', 'logs'] as const;

export default function IotForwardsPage() {
  const [activeTab, setActiveTab] = useUrlTabState(FORWARD_TABS, 'rules');
  const [logsFilter, setLogsFilter] = useState<IotForwardRule | null>(null);

  const showLogs = useMemo(() => (rule: IotForwardRule) => {
    setLogsFilter(rule);
    setActiveTab('logs');
  }, [setActiveTab]);

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" collapsible="auto" activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof FORWARD_TABS[number])}>
        <TabPane tab="流转规则" itemKey="rules">
          <ForwardRulesTab onShowLogs={showLogs} />
        </TabPane>
        <TabPane tab="投递日志" itemKey="logs">
          <ForwardLogsTab filterRule={logsFilter} onClearFilter={() => setLogsFilter(null)} />
        </TabPane>
      </Tabs>
    </div>
  );
}
