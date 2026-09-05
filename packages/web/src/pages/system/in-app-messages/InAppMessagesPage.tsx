
import { Button, Col, Form, Modal, Row, Tag, Toast } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import { CheckCheck, Plus } from 'lucide-react';
import type { InAppMessage, InAppMessageType } from '@zenith/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
import { useAllUsers } from '@/hooks/queries/users';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import {
  inAppMessageKeys,
  useDeleteInAppMessage,
  useEnabledInAppTemplates,
  useInAppMessageList,
  useMarkAllInAppMessagesRead,
  useMarkInAppMessageRead,
  useSendInAppMessage,
  type SendInAppValues,
} from '@/hooks/queries/in-app-messages';
import { IN_APP_MESSAGE_TYPE_OPTIONS_WITH_COLOR as TYPE_OPTIONS } from '../in-app-message-constants';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { parseTemplateVariables } from '../send-log-constants';

const READ_OPTIONS = [
  { label: '未读', value: 'false' },
  { label: '已读', value: 'true' },
];

/** 发送站内信表单值：变量以 JSON 文本输入 */
interface SendInAppFormValues {
  templateId?: number;
  userIds: number[];
  title?: string;
  content?: string;
  type?: InAppMessageType;
  variables?: string;
}

export default function InAppMessagesPage() {
  const { hasPermission: can } = usePermission();

  interface SearchParams { keyword: string; filterType: InAppMessageType | undefined; filterRead: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterType: undefined, filterRead: undefined };
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: inAppMessageKeys.lists });

  const listQuery = useInAppMessageList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    type: submittedParams.filterType,
    isRead: submittedParams.filterRead === undefined ? undefined : submittedParams.filterRead === 'true',
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const sendMutation = useSendInAppMessage();
  const sendModal = useEditModal<{ id: number }, SendInAppFormValues, SendInAppValues>({
    save: {
      isPending: sendMutation.isPending,
      mutateAsync: async ({ values }) => {
        await sendMutation.mutateAsync({ body: values });
        return { id: 0 };
      },
    },
    defaults: { type: 'info' },
    beforeSave: (values) => ({ ...values, variables: parseTemplateVariables(values.variables) }),
    successMessage: () => '发送成功',
    onSaved: () => globalThis.dispatchEvent(new CustomEvent('in-app-messages:refresh')),
    labelWidth: 120,
  });
  const templatesQuery = useEnabledInAppTemplates(sendModal.visible);
  const usersQuery = useAllUsers({ enabled: sendModal.visible });
  const templates = templatesQuery.data?.list ?? [];
  const users = usersQuery.data ?? [];
  const markReadMutation = useMarkInAppMessageRead();
  const markAllReadMutation = useMarkAllInAppMessagesRead();
  const deleteMutation = useDeleteInAppMessage();

  const handleMarkRead = async (id: number) => {
    await markReadMutation.mutateAsync({ params: { id } });
    Toast.success('已标记为已读');
    globalThis.dispatchEvent(new CustomEvent('in-app-messages:refresh'));
  };

  const handleMarkAllRead = () => {
    Modal.confirm({
      title: '确定要将所有未读消息标记为已读吗？',
      onOk: async () => {
        await markAllReadMutation.mutateAsync({});
        Toast.success('已全部标记为已读');
        globalThis.dispatchEvent(new CustomEvent('in-app-messages:refresh'));
      },
    });
  };

  const handleDelete = (id: number) => {
    confirmDelete({
      title: '确定要删除该消息吗？',
      onOk: async () => {
        await deleteMutation.mutateAsync({ params: { id } });
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
    dateTimeColumn('阅读时间', 'readAt'),
    createdAtColumn,
    {
      title: '状态', dataIndex: 'isRead', width: 90, fixed: 'right' as const,
      render: (v: boolean) => v ? <Tag color="green" type="light">已读</Tag> : <Tag color="orange" type="light">未读</Tag>,
    },
    createOperationColumn<InAppMessage>({
      width: 180,
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
            <KeywordInput placeholder="标题/内容关键词" value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onSearch={handleSearch} width={200} />
            <FilterSelect
              placeholder="全部类型"
              items={TYPE_OPTIONS}
              value={draftParams.filterType}
              onChange={(v) => setDraftParams({ ...draftParams, filterType: v as InAppMessageType | undefined })}
            />
            <FilterSelect
              placeholder="全部阅读状态"
              items={READ_OPTIONS}
              value={draftParams.filterRead}
              onChange={(v) => setDraftParams({ ...draftParams, filterRead: v as string | undefined })}
              width={140}
            />
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
            {can('system:in-app-message:update') && (
              <Button type="tertiary" icon={<CheckCheck size={14} />} onClick={handleMarkAllRead}>全部已读</Button>
            )}
            {can('system:in-app-message:send') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={sendModal.openCreate}>发送站内信</Button>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <KeywordInput placeholder="标题/内容关键词" value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onSearch={handleSearch} width={200} />
            <SearchButton onClick={handleSearch} />
            {can('system:in-app-message:send') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={sendModal.openCreate}>发送站内信</Button>
            )}
          </>
        )}
        mobileFilters={(
          <>
            <FilterSelect
              placeholder="全部类型"
              items={TYPE_OPTIONS}
              value={draftParams.filterType}
              onChange={(v) => setDraftParams({ ...draftParams, filterType: v as InAppMessageType | undefined })}
            />
            <FilterSelect
              placeholder="全部阅读状态"
              items={READ_OPTIONS}
              value={draftParams.filterRead}
              onChange={(v) => setDraftParams({ ...draftParams, filterRead: v as string | undefined })}
              width={140}
            />
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
        pagination={buildPagination(total)} />

      <AppModal {...sendModal.modalProps} title="发送站内信" width={720}>
        <Form key={sendModal.formKey} {...sendModal.formProps}>
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
