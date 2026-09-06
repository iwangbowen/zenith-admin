import { useMemo, useState } from 'react';
import { Col, Form, Row, SideSheet, Spin, TabPane, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { CronBuilderPopover } from '@/components/CronBuilderPopover';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
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
  IOT_SCHEDULE_ACTION_LABELS, IOT_SCHEDULE_ACTION_OPTIONS,
  IOT_SCHEDULE_TYPE_LABELS, IOT_SCHEDULE_TYPE_OPTIONS,
} from '@zenith/shared/iot';
import type { CreateIotScheduleInput, IotSchedule, IotScheduleRun } from '@zenith/shared/iot';
import { useIotDeviceOptions, useIotGroupOptions, useIotProductOptions } from './components/IotSelectors';
import { IotEnabledTag } from './components/IotStatus';
import { IotServiceSelectField } from './components/ThingModelFields';
import { formatIotDateTime, jsonObjectToText, parseJsonObjectInput, toFiveFieldCron, toSixFieldCron } from './iot-form-utils';
import {
  iotScheduleKeys, useDeleteIotSchedules, useIotScheduleList,
  useIotScheduleRunList, useSaveIotSchedule,
} from '@/hooks/queries/iot-schedules';

const { Text } = Typography;

function describeScheduleAction(r: IotSchedule): string {
  if (r.actionType === 'command') return `${IOT_SCHEDULE_ACTION_LABELS.command}：${r.service ?? ''}`;
  return `${IOT_SCHEDULE_ACTION_LABELS.desired}：${Object.keys(r.desired ?? {}).join('、')}`;
}

/** 计划表单值：执行时刻在表单里可为 Date，参数 / 期望属性以 JSON 文本编辑，提交前由 beforeSave 解析 */
interface ScheduleFormValues extends Partial<Omit<CreateIotScheduleInput, 'runAt' | 'params' | 'desired'>> {
  runAt?: string | Date | null;
  paramsText?: string;
  desiredText?: string;
}

// ─── 计划列表 Tab ─────────────────────────────────────────────────────────────
interface ScheduleSearchParams {
  keyword: string;
  status?: string;
}

const defaultSearch: ScheduleSearchParams = { keyword: '', status: '' };

function SchedulesTab({ onShowRuns }: Readonly<{ onShowRuns: (schedule: IotSchedule) => void }>) {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<ScheduleSearchParams>({ defaults: defaultSearch, listKey: iotScheduleKeys.lists });

  const listQuery = useIotScheduleList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  });
  const { items: statusItems } = useDictItems('common_status');

  const modal = useEditModal<IotSchedule, ScheduleFormValues, Partial<CreateIotScheduleInput>>({
    entityName: '计划任务',
    save: useSaveIotSchedule(),
    toValues: (r) => ({
      name: r.name,
      scheduleType: r.scheduleType,
      cronExpression: r.cronExpression ?? '',
      runAt: r.runAt,
      productId: r.productId,
      groupId: r.groupId,
      deviceId: r.deviceId,
      actionType: r.actionType,
      service: r.service,
      paramsText: jsonObjectToText(r.params),
      desiredText: jsonObjectToText(r.desired),
      status: r.status,
    }),
    defaults: { scheduleType: 'cron', actionType: 'desired', cronExpression: '0 22 * * *', status: 'enabled' },
    beforeSave: (values, { isEdit }) => ({
      name: values.name,
      ...(isEdit ? {} : {
        scheduleType: values.scheduleType,
        productId: values.productId,
        actionType: values.actionType,
      }),
      cronExpression: values.scheduleType === 'cron' ? (values.cronExpression?.trim() || null) : null,
      runAt: values.scheduleType === 'once' ? formatIotDateTime(values.runAt) : null,
      groupId: values.groupId ?? null,
      deviceId: values.deviceId ?? null,
      service: values.actionType === 'command' ? (values.service || null) : null,
      params: values.actionType === 'command' ? ((parseJsonObjectInput({ text: values.paramsText, label: '服务参数', empty: 'undefined', toast: 'warning', objectMessage: '服务参数 需为 JSON 对象，如 {"power":"on"}' }) as Record<string, string | number | boolean> | undefined) ?? null) : null,
      desired: values.actionType === 'desired' ? ((parseJsonObjectInput({ text: values.desiredText, label: '期望属性', empty: 'undefined', toast: 'warning', objectMessage: '期望属性 需为 JSON 对象，如 {"power":"on"}' }) as Record<string, string | number | boolean> | undefined) ?? null) : null,
      status: values.status,
    }),
    labelWidth: 110,
  });

  const deleteMutation = useDeleteIotSchedules();

  const columns: ColumnProps<IotSchedule>[] = [
    {
      title: '计划名称', dataIndex: 'name', minWidth: 170,
      render: (v: string) => renderEllipsis(v),
    },
    {
      title: '调度', width: 240,
      render: (_: unknown, r: IotSchedule) => (
        <span style={{ whiteSpace: 'nowrap' }}>
          <Tag size="small" color={r.scheduleType === 'cron' ? 'blue' : 'purple'}>{IOT_SCHEDULE_TYPE_LABELS[r.scheduleType]}</Tag>
          <Text size="small" code style={{ marginLeft: 6 }}>{r.scheduleType === 'cron' ? r.cronExpression : r.runAt}</Text>
        </span>
      ),
    },
    {
      title: '动作', width: 210,
      render: (_: unknown, r: IotSchedule) => renderEllipsis(describeScheduleAction(r)),
    },
    {
      title: '目标', width: 190,
      render: (_: unknown, r: IotSchedule) => {
        if (r.deviceName) return renderEllipsis(`设备：${r.deviceName}`);
        if (r.groupName) return renderEllipsis(`分组：${r.groupName}`);
        return renderEllipsis(`产品：${r.productName ?? ''}`);
      },
    },
    dateTimeColumn<IotSchedule>('下次执行', 'nextRunAt'),
    {
      title: '近 24h', dataIndex: 'recentRunCount', width: 90, align: 'right',
      render: (v: number, r: IotSchedule) => v > 0
        ? <a onClick={() => onShowRuns(r)} style={{ cursor: 'pointer' }}>{v} 次</a>
        : EMPTY_PLACEHOLDER,
    },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (v: IotSchedule['status']) => <IotEnabledTag status={v} />,
    },
    createOperationColumn<IotSchedule>({
      width: 240,
      actions: (record) => [
        { key: 'runs', label: '执行记录', onClick: () => onShowRuns(record) },
        ...(hasPermission('iot:schedule:update') ? [{
          key: 'edit', label: '编辑', onClick: () => modal.openEdit(record),
        }] : []),
        deleteAction({
          hidden: !hasPermission('iot:schedule:delete'),
          title: `确定要删除计划「${record.name}」吗？`,
          content: '执行记录将一并删除',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  const renderKeyword = () => (
    <KeywordInput
      placeholder="搜索计划名称..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      onSearch={handleSearch}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={statusItems}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderCreateButton = () => hasPermission('iot:schedule:create')
    ? <CreateButton onClick={modal.openCreate}>新增计划</CreateButton> : null;

  return (
    <>
      <ListSearchToolbar
        keyword={renderKeyword()}
        filters={renderStatusFilter()}
        onSearch={handleSearch}
        onReset={handleReset}
        create={renderCreateButton()}
        filterTitle="筛选条件"
      />
      <ConfigurableTable<IotSchedule>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无计划任务，点击「新增计划」创建第一条（如：每天 22:00 关闭指示灯）' })}
      />

      <AppModal {...modal.modalProps} width={660}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            {({ formState }) => (
              <ScheduleFormBody
                isEdit={modal.isEdit}
                values={formState.values as Record<string, unknown>}
                onApplyCron={(expr) => modal.formApi.current?.setValue('cronExpression', expr)}
              />
            )}
          </Form>
        </Spin>
      </AppModal>
    </>
  );
}

function ScheduleFormBody({ isEdit, values, onApplyCron }: Readonly<{
  isEdit: boolean;
  values: Record<string, unknown>;
  onApplyCron: (expr: string) => void;
}>) {
  const { options: productOptions } = useIotProductOptions();
  const { options: groupOptions } = useIotGroupOptions();
  const productId = (values.productId as number | undefined) ?? null;
  const scheduleType = (values.scheduleType as string | undefined) ?? 'cron';
  const actionType = (values.actionType as string | undefined) ?? 'desired';
  const { options: deviceOptions } = useIotDeviceOptions(productId, productId !== null);
  const { items: statusItems } = useDictItems('common_status');

  return (
    <>
      <Form.Input field="name" label="计划名称" placeholder="如：夜间关闭指示灯"
        rules={[{ required: true, message: '计划名称不能为空' }]} />
      <Row gutter={16}>
        <Col span={12}>
          <Form.RadioGroup field="scheduleType" label="调度类型" disabled={isEdit}
            extraText={isEdit ? '调度类型不可变更' : undefined}>
            {IOT_SCHEDULE_TYPE_OPTIONS.map((o) => (
              <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>
            ))}
          </Form.RadioGroup>
        </Col>
        <Col span={12}>
          <Form.RadioGroup field="status" label="状态">
            {statusItems.map((o) => (
              <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>
            ))}
          </Form.RadioGroup>
        </Col>
      </Row>
      {scheduleType === 'cron' ? (
        <Form.Input field="cronExpression" label="cron 表达式" placeholder="如 0 22 * * *"
          rules={[{ required: true, message: '请填写 cron 表达式' }]}
          extraText="五段格式（分 时 日 月 周），如 0 22 * * * = 每天 22:00"
          addonAfter={
            <CronBuilderPopover
              value={toSixFieldCron((values.cronExpression as string | undefined) ?? '')}
              onApply={(expr) => onApplyCron(toFiveFieldCron(expr))}
            />
          } />
      ) : (
        <Form.DatePicker field="runAt" label="执行时刻" type="dateTime" style={{ width: '100%' }}
          rules={[{ required: true, message: '请选择执行时刻' }]}
          extraText="到点执行一次后自动停用" />
      )}
      <Row gutter={16}>
        <Col span={12}>
          <Form.Select
            field="productId" label="所属产品" placeholder="选择产品" style={{ width: '100%' }}
            disabled={isEdit}
            extraText={isEdit ? '所属产品不可变更' : undefined}
            optionList={productOptions}
            rules={isEdit ? [] : [{ required: true, message: '请选择所属产品' }]}
          />
        </Col>
        <Col span={12}>
          <Form.Select
            field="deviceId" label="限定设备" placeholder="不限" showClear style={{ width: '100%' }}
            optionList={deviceOptions}
          />
        </Col>
      </Row>
      <Form.Select
        field="groupId" label="限定分组" placeholder="不限（产品下全部设备）" showClear style={{ width: '100%' }}
        optionList={groupOptions}
        extraText="目标优先级：设备 > 分组 > 产品全部（上限 500 台）"
      />
      <Form.RadioGroup field="actionType" label="动作类型" disabled={isEdit}
        extraText={isEdit ? '动作类型不可变更' : undefined}>
        {IOT_SCHEDULE_ACTION_OPTIONS.map((o) => (
          <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>
        ))}
      </Form.RadioGroup>
      {actionType === 'command' && (
        <Row gutter={16}>
          <Col span={12}>
            <IotServiceSelectField productId={productId} />
          </Col>
          <Col span={12}>
            <Form.Input field="paramsText" label="服务参数" placeholder='JSON 对象（可空），如 {"speed":2}' />
          </Col>
        </Row>
      )}
      {actionType === 'desired' && (
        <Form.Input field="desiredText" label="期望属性" placeholder='JSON 对象，如 {"led_enabled":false}'
          rules={[{ required: true, message: '请填写期望属性' }]} />
      )}
    </>
  );
}

// ─── 执行记录 Tab ─────────────────────────────────────────────────────────────
function ScheduleRunsTab({ filterSchedule, onClearFilter }: Readonly<{
  filterSchedule: IotSchedule | null;
  onClearFilter: () => void;
}>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detailRun, setDetailRun] = useState<IotScheduleRun | null>(null);

  const listQuery = useIotScheduleRunList({
    page,
    pageSize,
    scheduleId: filterSchedule?.id,
  });
  const columns: ColumnProps<IotScheduleRun>[] = [
    dateTimeColumn<IotScheduleRun>('执行时间', 'createdAt'),
    {
      title: '计划', dataIndex: 'scheduleName', minWidth: 200,
      render: (v: string) => renderEllipsis(v),
    },
    { title: '目标数', dataIndex: 'deviceCount', width: 90, align: 'right' },
    {
      title: '成功', dataIndex: 'successCount', width: 80, align: 'right',
      render: (v: number) => <Text type="success">{v}</Text>,
    },
    {
      title: '失败', dataIndex: 'failedCount', width: 80, align: 'right',
      render: (v: number) => v > 0 ? <Text type="danger">{v}</Text> : EMPTY_PLACEHOLDER,
    },
    createOperationColumn<IotScheduleRun>({
      width: 120,
      actions: (record) => [
        ...(record.errors.length > 0 ? [{
          key: 'detail', label: '失败明细', onClick: () => setDetailRun(record),
        }] : []),
      ],
    }),
  ];

  return (
    <>
      <SearchToolbar
        primary={filterSchedule ? (
          <Tag closable onClose={onClearFilter} color="blue">计划：{filterSchedule.name}</Tag>
        ) : <Text type="tertiary" size="small">全部计划的执行流水</Text>}
      />
      <ConfigurableTable<IotScheduleRun>
        columns={columns}
        {...listTableProps(listQuery, {
          empty: '暂无执行记录',
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
        title="失败明细"
        visible={detailRun !== null}
        onCancel={() => setDetailRun(null)}
        width={480}
      >
        {detailRun && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detailRun.errors.map((e) => (
              <div key={`${e.deviceId}-${e.sn}`} style={{
                padding: '8px 12px', borderRadius: 'var(--semi-border-radius-medium)',
                background: 'var(--semi-color-fill-0)',
              }}>
                <Text size="small" strong style={{ display: 'block' }}>{e.sn}</Text>
                <Text size="small" type="danger">{e.error}</Text>
              </div>
            ))}
          </div>
        )}
      </SideSheet>
    </>
  );
}

// ─── 页面 ─────────────────────────────────────────────────────────────────────
const SCHEDULE_TABS = ['schedules', 'runs'] as const;

export default function IotSchedulesPage() {
  const [activeTab, setActiveTab] = useUrlTabState(SCHEDULE_TABS, 'schedules');
  const [runsFilter, setRunsFilter] = useState<IotSchedule | null>(null);

  const showRuns = useMemo(() => (schedule: IotSchedule) => {
    setRunsFilter(schedule);
    setActiveTab('runs');
  }, [setActiveTab]);

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" collapsible="auto" activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof SCHEDULE_TABS[number])}>
        <TabPane tab="计划任务" itemKey="schedules">
          <SchedulesTab onShowRuns={showRuns} />
        </TabPane>
        <TabPane tab="执行记录" itemKey="runs">
          <ScheduleRunsTab filterSchedule={runsFilter} onClearFilter={() => setRunsFilter(null)} />
        </TabPane>
      </Tabs>
    </div>
  );
}
