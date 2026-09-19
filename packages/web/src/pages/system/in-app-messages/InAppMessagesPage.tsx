
import { useMemo, useState } from 'react';
import { Button, Col, Form, Modal, Row, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { CheckCheck, Plus } from 'lucide-react';
import { SEND_SOURCE_LABELS, SEND_SOURCE_OPTIONS, type InAppMessage, type InAppMessageType, type SendSource } from '@zenith/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar } from '@/components/list-page';
import { createdAtColumn, dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '../../../utils/table-columns';
import { toUserOptions, useAllUsers } from '@/hooks/queries/users';
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
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { parseTemplateVariables } from '../send-log-constants';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

const READ_OPTIONS = [
  { label: '未读', value: 'false' },
  { label: '已读', value: 'true' },
];

const { Text } = Typography;

/** 类型标签：列表列与详情弹窗共用同一套取值 */
function renderTypeTag(type: InAppMessageType) {
  const item = TYPE_OPTIONS.find((t) => t.value === type);
  return <Tag color={item?.color ?? 'grey'} type="light">{item?.label ?? type}</Tag>;
}

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

  interface SearchParams {
    keyword: string;
    filterType: InAppMessageType | undefined;
    filterRead: string | undefined;
    filterRecipient: number | undefined;
    filterSource: SendSource | undefined;
  }
  const defaultSearchParams: SearchParams = {
    keyword: '',
    filterType: undefined,
    filterRead: undefined,
    filterRecipient: undefined,
    filterSource: undefined,
  };
  const {
    bind,
    bindKeyword,
    handleSearch,
    handleReset,
    tableProps,
  } = useListPage({
    defaults: defaultSearchParams,
    listKey: inAppMessageKeys.lists,
    useList: useInAppMessageList,
    toQuery: (s) => ({
      keyword: s.keyword,
      type: s.filterType,
      isRead: s.filterRead === undefined ? undefined : s.filterRead === 'true',
      recipientId: s.filterRecipient,
      source: s.filterSource,
    }),
  });


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
  // 收件人筛选的用户源与发送弹窗共用同一份查询（key 相同）；选项数组要 memo，
  // 否则关键字每敲一个字整条工具栏都会重渲染（FilterSelect 是 memo 组件）
  const filterUsersQuery = useAllUsers();
  const userOptions = useMemo(() => toUserOptions(filterUsersQuery.data ?? []), [filterUsersQuery.data]);
  const templates = templatesQuery.data?.list ?? [];
  const users = usersQuery.data ?? [];
  const markReadMutation = useMarkInAppMessageRead();
  const markAllReadMutation = useMarkAllInAppMessagesRead();
  const deleteMutation = useDeleteInAppMessage();
  /** 详情弹窗当前查看的记录；直接取列表行（按 id 的 detail 接口是「我的站内信」，管理员视角无法用它） */
  const [detail, setDetail] = useState<InAppMessage | null>(null);

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


  const columns = [
    // 标题是这张表的主列：写 minWidth 作为弹性主列吸收剩余宽度；内容只是摘要预览，必须写固定宽度。
    // 两列都不写宽度时浏览器会把剩余空间平分，标题会与自己的内容摘要一样窄。
    { title: '标题', dataIndex: 'title', minWidth: 260, render: renderEllipsis },
    { title: '内容', dataIndex: 'content', width: 260, render: renderEllipsis },
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: renderTypeTag,
    },
    { title: '收件人', dataIndex: 'username', width: 120, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    { title: '发送人', dataIndex: 'senderName', width: 120, render: (v: string | null) => v || '系统' },
    dateTimeColumn('阅读时间', 'readAt'),
    createdAtColumn,
    {
      title: '状态', dataIndex: 'isRead', width: 90, fixed: 'right' as const,
      render: (v: boolean) => v ? <Tag color="green" type="light">已读</Tag> : <Tag color="orange" type="light">未读</Tag>,
    },
    createOperationColumn<InAppMessage>({
      // 详情 / 标记已读 / 删除 = 2 字 + 4 字 + 2 字 → 内容宽 192，列宽 240
      width: 240,
      actions: (record) => [
        {
          key: 'detail',
          label: '详情',
          onClick: () => setDetail(record),
        },
        {
          key: 'mark-read',
          label: '标记已读',
          hidden: !can('system:in-app-message:read') || record.isRead,
          onClick: () => handleMarkRead(record.id),
        },
        deleteAction({
          hidden: !can('system:in-app-message:delete'),
          title: '确定要删除该消息吗？',
          run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
          onDeleted: () => globalThis.dispatchEvent(new CustomEvent('in-app-messages:refresh')),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="标题/内容关键词" {...bindKeyword('keyword')} width={200} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部类型"
              items={TYPE_OPTIONS}
              {...bind('filterType')}
            />
            <FilterSelect
              placeholder="全部阅读状态"
              items={READ_OPTIONS}
              {...bind('filterRead')}
              width={140}
            />
            <FilterSelect
              placeholder="全部收件人"
              items={userOptions}
              {...bind('filterRecipient')}
              width={150}
              filter
            />
            {/* 来源是区分「人发的」与「系统自动投递」的维度：发送人只对手工发送有值，按人筛覆盖面太窄 */}
            <FilterSelect
              placeholder="全部来源"
              items={SEND_SOURCE_OPTIONS}
              {...bind('filterSource')}
              width={140}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={can('system:in-app-template:list') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={sendModal.openCreate}>发送站内信</Button>
        )}
        actions={can('system:in-app-message:read') && (
          <Button type="tertiary" icon={<CheckCheck size={14} />} onClick={handleMarkAllRead}>全部已读</Button>
        )}
        filterTitle="站内信筛选"
        actionTitle="站内信操作"
      />

      <ConfigurableTable<InAppMessage>
        columns={columns}
        {...tableProps}
      />

      <EditFormModal modal={sendModal} title="发送站内信" width={720}>
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
      </EditFormModal>

      {/* 详情弹窗：版式对齐站内信收件箱（标题在头部、正文 pre-wrap 保留换行），
          管理员视角额外展示收件人 / 发送人 / 来源等只在列表里看得到的信息 */}
      <AppModal
        title={detail?.title ?? ''}
        visible={detail !== null}
        onCancel={() => setDetail(null)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {detail && !detail.isRead && can('system:in-app-message:read') && (
              <Button
                type="primary"
                theme="solid"
                onClick={() => { void handleMarkRead(detail.id).then(() => setDetail(null)); }}
              >
                标记已读
              </Button>
            )}
            <Button type="tertiary" onClick={() => setDetail(null)}>关闭</Button>
          </div>
        }
        width={640}
        closeOnEsc
      >
        {detail && (
          <>
            {/* 元信息分两处：正文上方只留「这是谁发的、发给谁、什么时候」，其余放正文下方，避免头部一大块键值表把正文挤下去 */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {renderTypeTag(detail.type)}
              <Text type="tertiary" size="small">
                收件人 {detail.username || EMPTY_PLACEHOLDER} · 发送人 {detail.senderName || '系统'} · {detail.createdAt}
              </Text>
            </div>
            <div style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {detail.content}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--semi-color-border)', fontSize: 12, color: 'var(--semi-color-text-3)' }}>
              <span>来源：{SEND_SOURCE_LABELS[detail.source]}</span>
              <span>模板：{detail.templateName || '未使用模板'}</span>
              <span>{detail.isRead ? `已于 ${detail.readAt ?? '未知时间'} 阅读` : '暂未阅读'}</span>
              {detail.link && <span>深链：<Text code>{detail.link}</Text></span>}
            </div>
          </>
        )}
      </AppModal>
    </div>
  );
}
