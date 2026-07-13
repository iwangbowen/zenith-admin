import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Input,
  Tag,
  Space,
  Modal,
  SideSheet,
  Form,
  Spin,
  Toast,
  Select,
  DatePicker,
  RadioGroup,
  Radio,
  Tabs,
  TabPane,
  Progress,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { Announcement, AnnouncementTargetType, AnnouncementReadStats, AnnouncementAttachment } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { UserAvatar } from '@/components/UserAvatar';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn, type ResponsiveTableAction } from '@/components/ResponsiveTableActions';
import FileAttachment from '@/components/FileAttachment';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { useDictItems } from '@/hooks/useDictItems';
import DictTag from '@/components/DictTag';
import { usePermission } from '@/hooks/usePermission';
import { TABLE_PAGE_SIZE_OPTIONS, usePagination } from '@/hooks/usePagination';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import {
  announcementKeys,
  useAnnouncementDetail,
  useAnnouncementList,
  useAnnouncementReadStats,
  useAnnouncementRecipientOptions,
  useAnnouncementUserSearch,
  useBatchDeleteAnnouncements,
  useDeleteAnnouncement,
  useSaveAnnouncement,
  useUpdateAnnouncementStatus,
} from '@/hooks/queries/announcements';

const RichTextEditor = lazy(() => import('@/components/RichTextEditor'));
const editorLoadingFallback = (
  <div
    style={{
      height: 500,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: '1px solid var(--semi-color-border)',
      borderRadius: 'var(--semi-border-radius-small)',
    }}
  >
    <Spin />
  </div>
);

type SelectOption = { value: number; label: string };

function mergeUserOptions(prev: SelectOption[], newResults: SelectOption[], selectedSet: Set<number>): SelectOption[] {
  const retained = prev.filter((o) => selectedSet.has(o.value));
  const retainedIds = new Set(retained.map((o) => o.value));
  return [...retained, ...newResults.filter((o) => !retainedIds.has(o.value))];
}

type SearchParams = {
  title: string;
  type: string;
  publishStatus: string;
  timeRange: [Date, Date] | null;
};

export default function AnnouncementsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const defaultSearchParams: SearchParams = { title: '', type: '', publishStatus: '', timeRange: null };
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingNotice, setEditingNotice] = useState<Announcement | null>(null);
  const [formApi, setFormApi] = useState<FormApi | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [contentHtml, setContentHtml] = useState('');
  const [editorKey, setEditorKey] = useState(0);

  // 收件人相关状态
  const [targetType, setTargetType] = useState<AnnouncementTargetType>('all');
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>([]);
  const [selectedDeptIds, setSelectedDeptIds] = useState<number[]>([]);
  const [userOptions, setUserOptions] = useState<{ value: number; label: string }[]>([]);
  const userSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [userSearchKeyword, setUserSearchKeyword] = useState('');

  // 附件相关状态
  const [attachmentFileIds, setAttachmentFileIds] = useState<string[]>([]);
  const [uploadedAttachments, setUploadedAttachments] = useState<AnnouncementAttachment[]>([]);

  const { items: typeItems } = useDictItems('announcement_type');
  const { items: statusItems } = useDictItems('announcement_publish_status');
  const { items: priorityItems } = useDictItems('announcement_priority');

  // ─── 查看详情 ─────────────────────────────────────────────────────────────────────────────
  const [viewOnly, setViewOnly] = useState(false);
  let sideSheetTitle = '新增公告';
  if (viewOnly) sideSheetTitle = '查看公告';
  else if (editingNotice) sideSheetTitle = '编辑公告';

  // ─── 已读统计 ─────────────────────────────────────────────────────────────────────────────
  const [statsDrawerVisible, setStatsDrawerVisible] = useState(false);
  const [statsNotice, setStatsNotice] = useState<Announcement | null>(null);
  const [statsTab, setStatsTab] = useState<'read' | 'unread'>('read');
  const [statsPage, setStatsPage] = useState(1);
  const [statsPageSize, setStatsPageSize] = useState(10);

  const listQuery = useAnnouncementList({
    page,
    pageSize,
    title: submittedParams.title || undefined,
    type: submittedParams.type || undefined,
    publishStatus: submittedParams.publishStatus || undefined,
    startTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[0]) : undefined,
    endTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[1]) : undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const detailQuery = useAnnouncementDetail(editingNotice?.id, modalVisible && !!editingNotice);
  const modalDetailLoading = !!editingNotice && detailQuery.isFetching;
  const recipientOptionsQuery = useAnnouncementRecipientOptions(modalVisible);
  const roleOptions = recipientOptionsQuery.data?.roles ?? [];
  const deptOptions = recipientOptionsQuery.data?.departments ?? [];
  const userSearchQuery = useAnnouncementUserSearch(userSearchKeyword, modalVisible);
  const statsQuery = useAnnouncementReadStats(
    { id: statsNotice?.id, tab: statsTab, page: statsPage, pageSize: statsPageSize },
    statsDrawerVisible,
  );
  const statsData = statsQuery.data ?? null;
  const statsLoading = statsQuery.isFetching;
  const saveMutation = useSaveAnnouncement();
  const deleteMutation = useDeleteAnnouncement();
  const batchDeleteMutation = useBatchDeleteAnnouncements();
  const updateStatusMutation = useUpdateAnnouncementStatus();

  useEffect(() => {
    const handler = () => { void queryClient.invalidateQueries({ queryKey: announcementKeys.lists }); };
    globalThis.addEventListener('announcement:refresh', handler);
    return () => globalThis.removeEventListener('announcement:refresh', handler);
  }, [queryClient]);

  useEffect(() => {
    if (!modalVisible || !detailQuery.data) return;
    const { targetType: t, recipients = [], attachments = [] } = detailQuery.data;
    setUploadedAttachments(attachments);
    setAttachmentFileIds(attachments.map((a) => a.fileId));
    setTargetType(t ?? 'all');
    setSelectedUserIds(recipients.filter((r) => r.recipientType === 'user').map((r) => r.recipientId));
    setSelectedRoleIds(recipients.filter((r) => r.recipientType === 'role').map((r) => r.recipientId));
    setSelectedDeptIds(recipients.filter((r) => r.recipientType === 'dept').map((r) => r.recipientId));
    const userRecipients = recipients.filter((r) => r.recipientType === 'user');
    if (userRecipients.length > 0) {
      setUserOptions((prev) => {
        const existingIds = new Set(prev.map((o) => o.value));
        const newOpts = userRecipients
          .filter((r) => !existingIds.has(r.recipientId))
          .map((r) => ({ value: r.recipientId, label: r.recipientLabel ?? String(r.recipientId) }));
        return [...prev, ...newOpts];
      });
    }
  }, [modalVisible, detailQuery.data]);

  useEffect(() => {
    if (!userSearchQuery.data) return;
    const currentSelectedIds = [...selectedUserIds];
    setUserOptions((prev) => mergeUserOptions(prev, userSearchQuery.data ?? [], new Set(currentSelectedIds)));
  }, [selectedUserIds, userSearchQuery.data]);

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: announcementKeys.lists });
  };

  const handleReset = () => {
    const empty = defaultSearchParams;
    setDraftParams(empty);
    setSubmittedParams(empty);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: announcementKeys.lists });
  };
  const buildExportQuery = () => ({
    ...(submittedParams.title ? { title: submittedParams.title } : {}),
    ...(submittedParams.type ? { type: submittedParams.type } : {}),
    ...(submittedParams.publishStatus ? { publishStatus: submittedParams.publishStatus } : {}),
    ...(submittedParams.timeRange
      ? {
          startTime: formatDateTimeForApi(submittedParams.timeRange[0]),
          endTime: formatDateTimeForApi(submittedParams.timeRange[1]),
        }
      : {}),
  });

  const openStatsDrawer = (notice: Announcement) => {
    setStatsNotice(notice);
    setStatsTab('read');
    setStatsPage(1);
    setStatsDrawerVisible(true);
  };

  const handleUserSearch = (keyword: string) => {
    if (userSearchTimer.current) clearTimeout(userSearchTimer.current);
    if (!keyword.trim()) return;
    const trimmed = keyword.trim();
    userSearchTimer.current = setTimeout(() => {
      setUserSearchKeyword(trimmed);
    }, 300);
  };

  const openCreateModal = () => {
    setViewOnly(false);
    setEditingNotice(null);
    setContentHtml('');
    setEditorKey((k) => k + 1);
    setTargetType('all');
    setSelectedUserIds([]);
    setSelectedRoleIds([]);
    setSelectedDeptIds([]);
    setUserOptions([]);
    setAttachmentFileIds([]);
    setUploadedAttachments([]);
    setModalVisible(true);
  };

  const openEditModal = async (record: Announcement, readOnly = false) => {
    setViewOnly(readOnly);
    setContentHtml(record.content ?? '');
    setEditorKey((k) => k + 1);
    setEditingNotice(record);
    setTargetType('all');
    setSelectedUserIds([]);
    setSelectedRoleIds([]);
    setSelectedDeptIds([]);
    setUserOptions([]);
    setAttachmentFileIds([]);
    setUploadedAttachments([]);
    setModalVisible(true);

  };

  const openViewModal = async (record: Announcement) => {
    await openEditModal(record, true);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  };

  const handlePublish = async (id: number) => {
    await updateStatusMutation.mutateAsync({ id, values: { publishStatus: 'published' } });
    Toast.success('发布成功');
  };

  const handleRecall = async (id: number) => {
    await updateStatusMutation.mutateAsync({ id, values: { publishStatus: 'recalled' } });
    Toast.success('撤回成功');
  };

  const handleCancelSchedule = async (id: number) => {
    await updateStatusMutation.mutateAsync({ id, values: { publishStatus: 'draft', publishTime: null } });
    Toast.success('已取消定时发布');
  };

  const handleBatchDelete = () => {
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 条公告？`,
      content: '删除后无法恢复，请确认操作',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await batchDeleteMutation.mutateAsync(selectedRowKeys);
        Toast.success('删除成功');
        setSelectedRowKeys([]);
      },
    });
  };

  const handleSubmit = async () => {
    if (!formApi) return;
    let values: Record<string, unknown>;
    try {
      values = await formApi.validate();
    } catch {
      throw new Error('validation');
    }
    const isContentEmpty = !contentHtml || contentHtml === '<p><br></p>';
    if (isContentEmpty) {
      Toast.warning('请输入公告内容');
      return;
    }
    const recipients =
      targetType === 'specific'
        ? [
            ...selectedUserIds.map((id) => ({ recipientType: 'user' as const, recipientId: id })),
            ...selectedRoleIds.map((id) => ({ recipientType: 'role' as const, recipientId: id })),
            ...selectedDeptIds.map((id) => ({ recipientType: 'dept' as const, recipientId: id })),
          ]
        : [];
    const scheduledDate = values.scheduledPublishTime as Date | undefined | null;
    let finalPublishStatus = (values.publishStatus as string) || 'draft';
    let finalPublishTime: string | null = null;
    if (scheduledDate) {
      if (scheduledDate <= new Date()) {
        Toast.warning('定时发布时间必须是未来时间');
        return;
      }
      finalPublishStatus = 'scheduled';
      finalPublishTime = formatDateTimeForApi(scheduledDate);
    }
    const payload = {
      title: values.title,
      content: contentHtml,
      type: values.type || 'notice',
      publishStatus: finalPublishStatus,
      priority: values.priority || 'medium',
      targetType,
      recipients,
      publishTime: finalPublishTime,
      fileIds: attachmentFileIds,
    };
    await saveMutation.mutateAsync({ id: editingNotice?.id, values: payload });
    Toast.success(editingNotice ? '更新成功' : '创建成功');
    setModalVisible(false);
  };

  /** 渲染已读统计 SideSheet 内容 */
  const renderStatsContent = () => {
    if (!statsData) return null;
    const readRatePercent = statsData.totalCount > 0
      ? Math.round((statsData.readCount / statsData.totalCount) * 100)
      : 0;
    const userColumns = [
      {
        title: '用户',
        dataIndex: 'username',
        render: (_: unknown, u: AnnouncementReadStats['list'][number]) => (
          <Space>
            <UserAvatar name={u.nickname ?? 'U'} avatar={u.avatar} semiSize="extra-extra-small" size={20} />
            <span>
              {u.nickname}
              <Typography.Text type="tertiary" size="small" style={{ marginLeft: 4 }}>({u.username})</Typography.Text>
            </span>
          </Space>
        ),
      },
    ];
    return (
      <>
        {/* 概要统计卡片 */}
        <div style={{ display: 'flex', gap: 24, padding: '0 0 20px', alignItems: 'center' }}>
          <div style={{ textAlign: 'center', minWidth: 64 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--semi-color-success)' }}>{statsData.readCount}</div>
            <Typography.Text type="tertiary" size="small">已读人数</Typography.Text>
          </div>
          <div style={{ textAlign: 'center', minWidth: 64 }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{statsData.totalCount}</div>
            <Typography.Text type="tertiary" size="small">收件人数</Typography.Text>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
              <Typography.Text size="small">阅读率</Typography.Text>
              <Typography.Text size="small" strong>{readRatePercent}%</Typography.Text>
            </div>
            <Progress percent={readRatePercent} size="large" />
          </div>
        </div>

        <Tabs
          activeKey={statsTab}
          onChange={(tab) => {
            const t = tab as 'read' | 'unread';
            setStatsTab(t);
            setStatsPage(1);
          }}
        >
          <TabPane tab={`已读 (${statsData.readCount})`} itemKey="read">
            <Table
              bordered
              size="small"
              loading={statsLoading}
              dataSource={statsTab === 'read' ? statsData.list : []}
              rowKey="id"
              pagination={{
                total: statsTab === 'read' ? statsData.total : statsData.readCount,
                currentPage: statsPage,
                pageSize: statsPageSize,
                showSizeChanger: true,
                pageSizeOpts: TABLE_PAGE_SIZE_OPTIONS,
                onPageChange: (p: number) => {
                  setStatsPage(p);
                },
                onPageSizeChange: (size: number) => {
                  setStatsPageSize(size);
                  setStatsPage(1);
                },
              }}
              columns={[
                ...userColumns,
                {
                  title: '已读时间',
                  dataIndex: 'readAt',
                  width: 180,
                  render: (v: string) => (v ? formatDateTime(v) : '—'),
                },
              ]}
            />
          </TabPane>
          <TabPane tab={`未读 (${statsData.totalCount - statsData.readCount})`} itemKey="unread">
            <Table
              bordered
              size="small"
              loading={statsLoading}
              dataSource={statsTab === 'unread' ? statsData.list : []}
              rowKey="id"
              pagination={{
                total: statsTab === 'unread' ? statsData.total : statsData.totalCount - statsData.readCount,
                currentPage: statsPage,
                pageSize: statsPageSize,
                showSizeChanger: true,
                pageSizeOpts: TABLE_PAGE_SIZE_OPTIONS,
                onPageChange: (p: number) => {
                  setStatsPage(p);
                },
                onPageSizeChange: (size: number) => {
                  setStatsPageSize(size);
                  setStatsPage(1);
                },
              }}
              columns={userColumns}
            />
          </TabPane>
        </Tabs>
      </>
    );
  };

  const publishStatusColorMap: Record<string, string> = {
    draft: 'grey',
    published: 'green',
    recalled: 'orange',
    scheduled: 'blue',
  };

  const getAnnouncementActions = (record: Announcement): ResponsiveTableAction[] => {
    if (record.publishStatus === 'draft') {
      return [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:announcement:update'),
          onClick: () => openEditModal(record),
        },
        {
          key: 'publish',
          label: '发布',
          type: 'primary',
          hidden: !hasPermission('system:announcement:update'),
          onClick: () => {
            Modal.confirm({
              title: '确定要发布该公告吗？',
              onOk: () => handlePublish(record.id),
            });
          },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:announcement:delete'),
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该公告吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ];
    }

    if (record.publishStatus === 'published') {
      return [
        {
          key: 'view',
          label: '查看',
          hidden: !hasPermission('system:announcement:update'),
          onClick: () => { void openViewModal(record); },
        },
        {
          key: 'recall',
          label: '撤回',
          danger: true,
          hidden: !hasPermission('system:announcement:update'),
          onClick: () => {
            Modal.confirm({
              title: '确定要撤回该公告吗？',
              content: '撤回后用户将无法查看该公告',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleRecall(record.id),
            });
          },
        },
      ];
    }

    if (record.publishStatus === 'recalled') {
      return [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:announcement:update'),
          onClick: () => openEditModal(record),
        },
        {
          key: 'republish',
          label: '重新发布',
          type: 'primary',
          hidden: !hasPermission('system:announcement:update'),
          onClick: () => {
            Modal.confirm({
              title: '确定要重新发布该公告吗？',
              onOk: () => handlePublish(record.id),
            });
          },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:announcement:delete'),
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该公告吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ];
    }

    if (record.publishStatus === 'scheduled') {
      return [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:announcement:update'),
          onClick: () => openEditModal(record),
        },
        {
          key: 'publish-now',
          label: '立即发布',
          type: 'primary',
          hidden: !hasPermission('system:announcement:update'),
          onClick: () => {
            Modal.confirm({
              title: '确定要立即发布该公告吗？',
              onOk: () => handlePublish(record.id),
            });
          },
        },
        {
          key: 'cancel-schedule',
          label: '取消定时',
          hidden: !hasPermission('system:announcement:update'),
          onClick: () => {
            Modal.confirm({
              title: '确定要取消定时发布吗？',
              content: '取消后公告将回到草稿状态',
              onOk: () => handleCancelSchedule(record.id),
            });
          },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:announcement:delete'),
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该公告吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ];
    }

    return [];
  };

  const columns: ColumnProps<Announcement>[] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '标题', dataIndex: 'title', width: 220, render: renderEllipsis },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (v: string) => <DictTag dictCode="announcement_type" value={v} />,
    },
    {
      title: '发布状态',
      dataIndex: 'publishStatus',
      width: 110,
      render: (v: string) => {
        const item = statusItems.find((i) => i.value === v);
        return <Tag color={publishStatusColorMap[v] as 'grey' | 'green' | 'orange' | 'blue'}>{item?.label ?? v}</Tag>;
      },
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 100,
      render: (v: string) => <DictTag dictCode="announcement_priority" value={v} />,
    },
    {
      title: '收件对象',
      dataIndex: 'targetType',
      width: 110,
      render: (v: string) =>
        v === 'all' ? (
          <Tag color="blue">全体用户</Tag>
        ) : (
          <Tag color="purple">指定范围</Tag>
        ),
    },
    {
      title: '已读统计',
      dataIndex: 'readCount',
      width: 110,
      render: (v: number, record: Announcement) => {
        if (record.publishStatus !== 'published') {
          return <span style={{ color: 'var(--semi-color-text-3)' }}>—</span>;
        }
        const count = v ?? 0;
        return (
          <Tag
            color={count > 0 ? 'green' : 'grey'}
            style={{ cursor: 'pointer' }}
            onClick={() => openStatsDrawer(record)}
          >
            {count} 已读
          </Tag>
        );
      },
    },
    { title: '创建人', dataIndex: 'createByName', width: 110 },
    {
      title: '发布时间',
      dataIndex: 'publishTime',
      width: 200,
      render: (v: string | null) => (v ? formatDateTime(v) : '-'),
    },
    createdAtColumn,
    createOperationColumn<Announcement>({
      width: 230,
      desktopInlineKeys: ['edit', 'publish', 'delete', 'view', 'recall', 'republish', 'publish-now', 'cancel-schedule'],
      actions: getAnnouncementActions,
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索标题"
              value={draftParams.title}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, title: v }))}
              onEnterPress={handleSearch}
              style={{ width: 200 }}
              showClear
            />
            <Select
              placeholder="公告类型"
              value={draftParams.type || undefined}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, type: typeof v === 'string' ? v : '' }))}
              optionList={typeItems.map((i) => ({ label: i.label, value: i.value }))}
              showClear
              style={{ width: 140 }}
            />
            <Select
              placeholder="发布状态"
              value={draftParams.publishStatus || undefined}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, publishStatus: typeof v === 'string' ? v : '' }))}
              optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))}
              showClear
              style={{ width: 140 }}
            />
            <DatePicker
              type="dateTimeRange"
              placeholder={['开始时间', '结束时间']}
              value={draftParams.timeRange ?? undefined}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, timeRange: v ? (v as [Date, Date]) : null }))}
              style={{ width: 360 }}
            />
            <Button icon={<Search size={14} />} type="primary" onClick={handleSearch}>查询</Button>
            <Button icon={<RotateCcw size={14} />} type="tertiary" onClick={handleReset}>重置</Button>
          </>
        )}
        actions={(
          <>
            <ExportButton entity="system.announcements" query={buildExportQuery()} />
            {selectedRowKeys.length > 0 && hasPermission('system:announcement:delete') && (
              <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
                批量删除 ({selectedRowKeys.length})
              </Button>
            )}
            {hasPermission('system:announcement:create') && <Button icon={<Plus size={14} />} type="primary" onClick={openCreateModal}>新增</Button>}
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索标题"
              value={draftParams.title}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, title: v }))}
              onEnterPress={handleSearch}
              style={{ width: 200 }}
              showClear
            />
            <Button icon={<Search size={14} />} type="primary" onClick={handleSearch}>查询</Button>
            {hasPermission('system:announcement:create') && <Button icon={<Plus size={14} />} type="primary" onClick={openCreateModal}>新增</Button>}
          </>
        )}
        mobileFilters={(
          <>
            <Select
              placeholder="公告类型"
              value={draftParams.type || undefined}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, type: typeof v === 'string' ? v : '' }))}
              optionList={typeItems.map((i) => ({ label: i.label, value: i.value }))}
              showClear
              style={{ width: 140 }}
            />
            <Select
              placeholder="发布状态"
              value={draftParams.publishStatus || undefined}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, publishStatus: typeof v === 'string' ? v : '' }))}
              optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))}
              showClear
              style={{ width: 140 }}
            />
            <DatePicker
              type="dateTimeRange"
              placeholder={['开始时间', '结束时间']}
              value={draftParams.timeRange ?? undefined}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, timeRange: v ? (v as [Date, Date]) : null }))}
              style={{ width: 360 }}
            />
          </>
        )}
        mobileActions={(
          <>
            <ExportButton entity="system.announcements" query={buildExportQuery()} variant="flat" />
            {selectedRowKeys.length > 0 && hasPermission('system:announcement:delete') && (
              <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
                批量删除 ({selectedRowKeys.length})
              </Button>
            )}
          </>
        )}
        filterTitle="公告筛选"
        actionTitle="公告操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="id"
        scroll={{ x: 1520 }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
        }}
        pagination={buildPagination(total)}
      />

      <SideSheet
        title={sideSheetTitle}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        width={860}
        afterVisibleChange={(visible) => { if (!visible) { formApi?.reset(); } }}
        footer={
          viewOnly ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={() => setModalVisible(false)}>关闭</Button>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              <Button type="primary" loading={saveMutation.isPending} disabled={modalDetailLoading} onClick={handleSubmit}>
                {editingNotice ? '保存' : '创建'}
              </Button>
            </div>
          )
        }
      >
        <Spin spinning={modalDetailLoading} tip="加载中..." size="small">
        <Form
          getFormApi={(api) => setFormApi(api)}
          layout="vertical"
          initValues={
            editingNotice
              ? {
                title: editingNotice.title,
                type: editingNotice.type,
                publishStatus: editingNotice.publishStatus === 'scheduled' ? 'draft' : editingNotice.publishStatus,
                priority: editingNotice.priority,
                scheduledPublishTime: editingNotice.publishStatus === 'scheduled' && editingNotice.publishTime
                  ? new Date(editingNotice.publishTime.replace(' ', 'T'))
                  : undefined,
              }
              : { type: 'notice', publishStatus: 'draft', priority: 'medium' }
          }
        >
          <Form.Input
            field="title"
            label="标题"
            placeholder="请输入公告标题"
            rules={[{ required: true, message: '标题不能为空' }]}
            disabled={viewOnly}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            <Form.Select
              field="type"
              label="公告类型"
              optionList={typeItems.map((i) => ({ label: i.label, value: i.value }))}
              placeholder="请选择类型"
              style={{ width: '100%' }}
              disabled={viewOnly}
            />
            <Form.Select
              field="publishStatus"
              label="发布状态"
              optionList={statusItems.filter(i => i.value !== 'scheduled').map((i) => ({ label: i.label, value: i.value }))}
              placeholder="请选择状态"
              style={{ width: '100%' }}
              disabled={viewOnly}
            />
            <Form.Select
              field="priority"
              label="优先级"
              optionList={priorityItems.map((i) => ({ label: i.label, value: i.value }))}
              placeholder="请选择优先级"
              style={{ width: '100%' }}
              disabled={viewOnly}
            />
          </div>
          <Form.DatePicker
            field="scheduledPublishTime"
            label="定时发布时间"
            type="dateTime"
            placeholder="留空则不定时发布，填入未来时间后保存将自动设为「定时发布」状态"
            disabledDate={(date: Date | undefined) => !!date && date < new Date()}
            style={{ width: '100%' }}
            extraText="提示：填入未来时间后保存将自动切换为「定时发布」状态"
            disabled={viewOnly}
          />
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 500 }}>收件对象</div>
            <RadioGroup
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as AnnouncementTargetType)}
              style={{ marginBottom: targetType === 'specific' ? 12 : 0 }}
              disabled={viewOnly}
            >
              <Radio value="all">全体用户</Radio>
              <Radio value="specific">指定范围</Radio>
            </RadioGroup>
            {targetType === 'specific' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--semi-color-text-1)' }}>用户</div>
                  <Select
                    multiple
                    showClear
                    filter
                    remote
                    loading={false}
                    placeholder="输入姓名或账号搜索"
                    value={selectedUserIds}
                    optionList={userOptions}
                    onSearch={handleUserSearch}
                    onChange={(v) => setSelectedUserIds(v as number[])}
                    style={{ width: '100%' }}
                    disabled={viewOnly}
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--semi-color-text-1)' }}>角色</div>
                  <Select
                    multiple
                    showClear
                    filter
                    loading={recipientOptionsQuery.isFetching}
                    placeholder="请选择角色"
                    value={selectedRoleIds}
                    optionList={roleOptions}
                    onChange={(v) => setSelectedRoleIds(v as number[])}
                    style={{ width: '100%' }}
                    disabled={viewOnly}
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--semi-color-text-1)' }}>部门</div>
                  <Select
                    multiple
                    showClear
                    filter
                    loading={recipientOptionsQuery.isFetching}
                    placeholder="请选择部门"
                    value={selectedDeptIds}
                    optionList={deptOptions}
                    onChange={(v) => setSelectedDeptIds(v as number[])}
                    style={{ width: '100%' }}
                    disabled={viewOnly}
                  />
                </div>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 4, fontSize: 14, fontWeight: 500 }}>内容</div>
            {modalVisible ? (
              <Suspense fallback={editorLoadingFallback}>
                <RichTextEditor
                  key={editorKey}
                  value={contentHtml}
                  onChange={setContentHtml}
                  placeholder="请输入公告内容"
                  height={500}
                  readOnly={viewOnly}
                />
              </Suspense>
            ) : null}
          </div>

          {/* 附件 */}
          <FileAttachment
            value={uploadedAttachments}
            mode={viewOnly ? 'view' : 'edit'}
            onChange={(items) => {
              setUploadedAttachments(items);
              setAttachmentFileIds(items.map((a) => a.fileId));
            }}
            title="附件"
            uploadTip="点击或拖拽上传附件"
          />
        </Form>
        </Spin>
      </SideSheet>

      {/* 已读统计 SideSheet */}
      <SideSheet
        title={`《${statsNotice?.title ?? ''}》已读统计`}
        visible={statsDrawerVisible}
        onCancel={() => setStatsDrawerVisible(false)}
        width={640}
        footer={null}
      >
        {statsLoading && !statsData
          ? <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
          : renderStatsContent()}
      </SideSheet>
    </div>
  );
}
