/**
 * 运营群发页。
 *
 * 活动 = 受众 × 渠道 × 文案;发送经任务中心分批走通知派发层
 * (站内信/推送/邮件复用各渠道适配器与用户免打扰设置),进度实时展示。
 */
import { useEffect, useRef, useState } from 'react';
import { Form, Modal, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import {
  BROADCAST_AUDIENCE_TYPE_LABELS,
  BROADCAST_AUDIENCE_TYPE_OPTIONS,
  BROADCAST_CHANNELS,
  BROADCAST_STATUSES,
  BROADCAST_STATUS_LABELS,
  BROADCAST_STATUS_OPTIONS,
  NOTIFICATION_CHANNEL_LABELS,
  type BroadcastAudienceType,
  type BroadcastCampaign,
  type BroadcastChannel,
  type BroadcastStatus,
  type CreateBroadcastInput,
} from '@zenith/shared/messaging';
import { enumValueOf } from '@zenith/shared/core';
import ConfigurableTable from '@/components/ConfigurableTable';
import AppModal from '@/components/AppModal';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { EMPTY_PLACEHOLDER, createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';
import InsertShortLinkButton from '@/components/short-link/InsertShortLinkButton';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import {
  broadcastKeys,
  useBroadcastDetail,
  useBroadcastList,
  useDeleteBroadcasts,
  useSaveBroadcast,
  useSendBroadcast,
} from '@/hooks/queries/broadcasts';
import { useQueryClient } from '@tanstack/react-query';

const { Text } = Typography;

const STATUS_COLORS: Record<BroadcastStatus, 'grey' | 'blue' | 'green' | 'red' | 'orange'> = {
  draft: 'grey',
  sending: 'blue',
  sent: 'green',
  failed: 'red',
  cancelled: 'orange',
};

const CHANNEL_OPTIONS = BROADCAST_CHANNELS.map((c) => ({ value: c, label: NOTIFICATION_CHANNEL_LABELS[c] }));

/** 可编辑状态(编辑后回草稿重新发送) */
const EDITABLE_STATUSES: BroadcastStatus[] = ['draft', 'failed', 'cancelled'];

interface SearchParams {
  keyword: string;
  status?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

interface BroadcastFormValues {
  title: string;
  content: string;
  link: string;
  channels: BroadcastChannel[];
  audienceType: BroadcastAudienceType;
  /** TagInput 产出字符串,提交时转数字 */
  audienceIds: string[];
  remark: string;
}

export default function BroadcastsPage() {
  const { hasPermission } = usePermission();
  const qc = useQueryClient();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: broadcastKeys.lists });

  const listQuery = useBroadcastList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(BROADCAST_STATUSES, submittedParams.status),
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  // 群发任务实时进度;任务结束时刷新列表让状态列落定
  const { tasks } = useMyAsyncTasks({ taskTypes: ['messaging-broadcast'] });
  const runningTaskIds = tasks.filter((t) => t.status === 'pending' || t.status === 'running').map((t) => t.id).join(',');
  const prevRunningRef = useRef(runningTaskIds);
  useEffect(() => {
    if (prevRunningRef.current !== runningTaskIds) {
      prevRunningRef.current = runningTaskIds;
      void qc.invalidateQueries({ queryKey: broadcastKeys.lists });
    }
  }, [runningTaskIds, qc]);

  const modal = useEditModal<BroadcastCampaign, BroadcastFormValues, CreateBroadcastInput>({
    entityName: '群发活动',
    save: useSaveBroadcast(),
    useDetail: useBroadcastDetail,
    defaults: { channels: ['inapp'], audienceType: 'all_users', audienceIds: [] },
    labelWidth: 90,
    toValues: (r) => ({
      title: r.title,
      content: r.content,
      link: r.link ?? '',
      channels: r.channels,
      audienceType: r.audienceType,
      audienceIds: r.audienceIds.map(String),
      remark: r.remark ?? '',
    }),
    // TagInput 产出字符串,接口要数字;全体受众时清空名单
    beforeSave: (values) => {
      const needList = values.audienceType === 'user_ids' || values.audienceType === 'member_ids';
      return {
        title: values.title,
        content: values.content,
        link: values.link || null,
        channels: values.channels,
        audienceType: values.audienceType,
        audienceIds: needList
          ? (values.audienceIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0)
          : [],
        remark: values.remark || null,
      };
    },
  });

  const sendMutation = useSendBroadcast();
  const deleteMutation = useDeleteBroadcasts();
  const [audienceType, setAudienceType] = useState<BroadcastAudienceType>('all_users');
  const needIds = audienceType === 'user_ids' || audienceType === 'member_ids';

  // 弹窗打开时同步受众类型联动状态
  useEffect(() => {
    if (modal.visible) {
      setAudienceType((modal.editing?.audienceType ?? 'all_users') as BroadcastAudienceType);
    }
  }, [modal.visible, modal.editing]);

  function handleSend(record: BroadcastCampaign) {
    Modal.confirm({
      title: `确认发送「${record.title}」？`,
      content: `受众:${BROADCAST_AUDIENCE_TYPE_LABELS[record.audienceType]}${record.audienceIds.length ? `（${record.audienceIds.length} 人）` : ''},渠道:${record.channels.map((c) => NOTIFICATION_CHANNEL_LABELS[c]).join('、')}。发送后经通知中心分批派发,不可撤回。`,
      onOk: async () => {
        await sendMutation.mutateAsync({ params: { id: record.id } });
        Toast.success('发送任务已提交');
      },
    });
  }

  const columns: ColumnProps<BroadcastCampaign>[] = [
    { title: '标题', dataIndex: 'title', width: 200, render: renderEllipsis },
    { title: '内容', dataIndex: 'content', minWidth: 240, render: renderEllipsis },
    {
      title: '渠道', dataIndex: 'channels', width: 150,
      render: (v: BroadcastChannel[]) => (
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {v.map((c) => <Tag key={c} size="small" type="light">{NOTIFICATION_CHANNEL_LABELS[c]}</Tag>)}
        </span>
      ),
    },
    {
      title: '受众', dataIndex: 'audienceType', width: 130,
      render: (v: BroadcastAudienceType, record: BroadcastCampaign) => (
        <Text size="small">
          {BROADCAST_AUDIENCE_TYPE_LABELS[v]}
          {record.audienceIds.length > 0 && <Text type="tertiary" size="small">（{record.audienceIds.length}）</Text>}
        </Text>
      ),
    },
    {
      title: '进度', dataIndex: 'enqueuedCount', width: 180,
      render: (_: unknown, record: BroadcastCampaign) => {
        const task = record.taskId ? tasks.find((t) => t.id === record.taskId) : undefined;
        if (task && (task.status === 'pending' || task.status === 'running')) {
          return <AsyncTaskProgress task={task} />;
        }
        if (record.totalRecipients === null) return EMPTY_PLACEHOLDER;
        return <Text size="small">{record.enqueuedCount}/{record.totalRecipients} 人</Text>;
      },
    },
    { title: '创建人', dataIndex: 'createdByName', width: 100, render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: BroadcastStatus) => <Tag color={STATUS_COLORS[v]} size="small">{BROADCAST_STATUS_LABELS[v]}</Tag>,
    },
    createOperationColumn<BroadcastCampaign>({
      width: 180,
      desktopInlineKeys: ['send', 'edit'],
      actions: (record) => [
        ...(hasPermission('system:broadcast:send') && record.status !== 'sending' && record.status !== 'sent' ? [{
          key: 'send', label: '发送', onClick: () => handleSend(record),
        }] : []),
        ...(hasPermission('system:broadcast:update') && EDITABLE_STATUSES.includes(record.status) ? [{
          key: 'edit', label: '编辑', onClick: () => modal.openEdit(record),
        }] : []),
        ...(hasPermission('system:broadcast:delete') && record.status !== 'sending' ? [{
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            confirmDelete({
              title: `确定要删除群发活动「${record.title}」吗？`,
              content: '仅删除活动记录,已派发的通知不受影响',
              onOk: async () => {
                await deleteMutation.mutateAsync([record.id]);
                Toast.success('删除成功');
              },
            });
          },
        }] : []),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput
      placeholder="搜索标题 / 内容..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      onSearch={handleSearch}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={BROADCAST_STATUS_OPTIONS}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderCreateButton = () => hasPermission('system:broadcast:create')
    ? <CreateButton onClick={modal.openCreate}>新建活动</CreateButton> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>
          {renderKeywordSearch()}
          {renderStatusFilter()}
          <SearchButton onClick={handleSearch} />
          <ResetButton onClick={handleReset} />
        </>}
        actions={renderCreateButton()}
        mobilePrimary={<>
          {renderKeywordSearch()}
          <SearchButton onClick={handleSearch} />
          {renderCreateButton()}
        </>}
        mobileFilters={renderStatusFilter()}
        filterTitle="筛选条件"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无群发活动,新建后圈定受众与渠道即可发送"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />

      <AppModal {...modal.modalProps} width={640}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Form.Input field="title" label="标题" placeholder="通知标题(即推送/站内信标题)" maxLength={200}
              rules={[{ required: true, message: '标题不能为空' }]} />
            <Form.TextArea field="content" label="内容" rows={4} maxCount={2000}
              rules={[{ required: true, message: '内容不能为空' }]}
              extraText={(
                <InsertShortLinkButton
                  onInsert={(url) => {
                    const api = modal.formApi.current;
                    if (!api) return;
                    const current = (api.getValue('content') as string | undefined) ?? '';
                    api.setValue('content', current ? `${current} ${url}` : url);
                  }}
                />
              )} />
            <Form.Input field="link" label="跳转链接" placeholder="可选,站内路由(/path)或外链" maxLength={500} />
            <Form.CheckboxGroup field="channels" label="投递渠道" direction="horizontal" options={CHANNEL_OPTIONS}
              rules={[{ required: true, message: '至少选择一个投递渠道' }]} />
            <Form.Select field="audienceType" label="受众" style={{ width: '100%' }}
              optionList={BROADCAST_AUDIENCE_TYPE_OPTIONS}
              onChange={(v) => setAudienceType(v as BroadcastAudienceType)} />
            {needIds && (
              <Form.TagInput
                field="audienceIds"
                label="ID 名单"
                placeholder="输入数字 ID 后回车,可粘贴逗号分隔列表"
                separator=","
                rules={[{
                  required: true,
                  validator: (_r, value: unknown[]) => Array.isArray(value) && value.length > 0 && value.every((v) => /^\d+$/.test(String(v))),
                  message: '至少一个纯数字 ID',
                }]}
              />
            )}
            <Form.Input field="remark" label="备注" placeholder="可选" maxLength={500} />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
