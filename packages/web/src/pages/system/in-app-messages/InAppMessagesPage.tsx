import { useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Col, Form, Input, Modal, Row, Select, Tag,
  Toast } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { CheckCheck, Plus, RotateCcw, Search } from 'lucide-react';
import type { InAppMessage, InAppMessageType } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import { useAllUsers } from '@/hooks/queries/users';
import {
  inAppMessageKeys,
  useDeleteInAppMessage,
  useEnabledInAppTemplates,
  useInAppMessageList,
  useMarkAllInAppMessagesRead,
  useMarkInAppMessageRead,
  useSendInAppMessage,
} from '@/hooks/queries/in-app-messages';
import { IN_APP_MESSAGE_TYPE_OPTIONS_WITH_COLOR as TYPE_OPTIONS } from '../in-app-message-constants';

const READ_OPTIONS = [
  { label: '未读', value: 'false' },
  { label: '已读', value: 'true' },
];

export default function InAppMessagesPage() {
  const { hasPermission: can } = usePermission();
  const queryClient = useQueryClient();

  interface SearchParams { keyword: string; filterType: InAppMessageType | undefined; filterRead: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterType: undefined, filterRead: undefined };
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const [sendVisible, setSendVisible] = useState(false);
  const formRef = useRef<FormApi>(null);

  const listQuery = useInAppMessageList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    type: submittedParams.filterType,
    isRead: submittedParams.filterRead,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const templatesQuery = useEnabledInAppTemplates(sendVisible);
  const usersQuery = useAllUsers({ enabled: sendVisible });
  const templates = templatesQuery.data?.list ?? [];
  const users = usersQuery.data ?? [];
  const sendMutation = useSendInAppMessage();
  const markReadMutation = useMarkInAppMessageRead();
  const markAllReadMutation = useMarkAllInAppMessagesRead();
  const deleteMutation = useDeleteInAppMessage();

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: inAppMessageKeys.lists });
  };
  const handleReset = () => {
    setPage(1);
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    void queryClient.invalidateQueries({ queryKey: inAppMessageKeys.lists });
  };

  const openSend = () => {
    setSendVisible(true);
  };

  const handleSend = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { throw new Error('validation'); }
    // 变量字段是 JSON 字符串，提交前解析为对象
    if (typeof values.variables === 'string') {
      const raw = values.variables.trim();
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            values.variables = parsed as Record<string, string>;
          } else {
            Toast.error('变量必须是 JSON 对象');
            return;
          }
        } catch {
          Toast.error('变量 JSON 格式错误');
          return;
        }
      } else {
        delete values.variables;
      }
    }
    await sendMutation.mutateAsync(values as Record<string, unknown>);
    Toast.success('发送成功');
    setSendVisible(false);
    globalThis.dispatchEvent(new CustomEvent('in-app-messages:refresh'));
  };

  const handleMarkRead = async (id: number) => {
    await markReadMutation.mutateAsync(id);
    Toast.success('已标记为已读');
    globalThis.dispatchEvent(new CustomEvent('in-app-messages:refresh'));
  };

  const handleMarkAllRead = () => {
    Modal.confirm({
      title: '确定要将所有未读消息标记为已读吗？',
      onOk: async () => {
        await markAllReadMutation.mutateAsync();
        Toast.success('已全部标记为已读');
        globalThis.dispatchEvent(new CustomEvent('in-app-messages:refresh'));
      },
    });
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确定要删除该消息吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(id);
        Toast.success('删除成功');
        globalThis.dispatchEvent(new CustomEvent('in-app-messages:refresh'));
      },
    });
  };

  const columns = [
    { title: '标题', dataIndex: 'title', render: renderEllipsis },
    { title: '内容', dataIndex: 'content', render: renderEllipsis },
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (v: InAppMessageType) => {
        const it = TYPE_OPTIONS.find((t) => t.value === v);
        return <Tag color={it?.color ?? 'grey'} type="light">{it?.label ?? v}</Tag>;
      },
    },
    { title: '收件人', dataIndex: 'username', width: 120, render: (v: string | null) => v || '—' },
    { title: '发送人', dataIndex: 'senderName', width: 120, render: (v: string | null) => v || '系统' },
    { title: '阅读时间', dataIndex: 'readAt', width: 180, render: (v: string | null) => v || '—' },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'isRead', width: 90, fixed: 'right' as const,
      render: (v: boolean) => v ? <Tag color="green" type="light">已读</Tag> : <Tag color="orange" type="light">未读</Tag>,
    },
    createOperationColumn<InAppMessage>({
      width: 160,
      actions: (record) => [
        {
          key: 'mark-read',
          label: '标记已读',
          hidden: !can('system:in-app-message:update') || record.isRead,
          onClick: () => handleMarkRead(record.id),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !can('system:in-app-message:delete'),
          onClick: () => handleDelete(record.id),
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="标题/内容关键词"
              value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 200 }} />
            <Select placeholder="类型" value={draftParams.filterType} onChange={(v) => setDraftParams({ ...draftParams, filterType: v as InAppMessageType | undefined })}
              optionList={TYPE_OPTIONS} showClear style={{ width: 110 }} />
            <Select placeholder="阅读状态" value={draftParams.filterRead} onChange={(v) => setDraftParams({ ...draftParams, filterRead: v as string | undefined })}
              optionList={READ_OPTIONS} showClear style={{ width: 120 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {can('system:in-app-message:update') && (
              <Button type="tertiary" icon={<CheckCheck size={14} />} onClick={handleMarkAllRead}>全部已读</Button>
            )}
            {can('system:in-app-message:send') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openSend}>发送站内信</Button>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="标题/内容关键词"
              value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 200 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {can('system:in-app-message:send') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openSend}>发送站内信</Button>
            )}
          </>
        )}
        mobileFilters={(
          <>
            <Select placeholder="类型" value={draftParams.filterType} onChange={(v) => setDraftParams({ ...draftParams, filterType: v as InAppMessageType | undefined })}
              optionList={TYPE_OPTIONS} showClear style={{ width: 110 }} />
            <Select placeholder="阅读状态" value={draftParams.filterRead} onChange={(v) => setDraftParams({ ...draftParams, filterRead: v as string | undefined })}
              optionList={READ_OPTIONS} showClear style={{ width: 120 }} />
          </>
        )}
        mobileActions={can('system:in-app-message:update') ? (
          <Button type="tertiary" icon={<CheckCheck size={14} />} onClick={handleMarkAllRead}>全部已读</Button>
        ) : null}
        filterTitle="站内信筛选"
        actionTitle="站内信操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)}
        scroll={{ x: 1400 }} />

      <AppModal title="发送站内信" visible={sendVisible} onOk={handleSend}
        onCancel={() => setSendVisible(false)} confirmLoading={sendMutation.isPending} width={720}>
        <Form key="send" getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
          allowEmpty labelPosition="left" labelWidth={120} initValues={{ type: 'info' }}>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Select field="userIds" label="收件人" multiple filter style={{ width: '100%' }}
                optionList={users.map((u) => ({ label: `${u.nickname || u.username} (${u.username})`, value: u.id }))}
                placeholder="请选择收件人"
                rules={[{ required: true, message: '请选择收件人' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Select field="templateId" label="模板" style={{ width: '100%' }} showClear filter
                optionList={templates.map((t) => ({ label: `${t.name} (${t.code})`, value: t.id }))}
                placeholder="可选，使用模板自动填充" />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Select field="type" label="类型" style={{ width: '100%' }} optionList={TYPE_OPTIONS}
                placeholder="请选择类型"
                rules={[{ required: true, message: '请选择类型' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Input field="title" label="标题" placeholder="请输入标题"
                rules={[{ required: true, message: '请输入标题' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="content" label="内容" rows={5} placeholder="请输入内容"
                rules={[{ required: true, message: '请输入内容' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Input field="variables" label="变量" placeholder='如：{"username":"张三"}' />
            </Col>
          </Row>
        </Form>
      </AppModal>
    </div>
  );
}
