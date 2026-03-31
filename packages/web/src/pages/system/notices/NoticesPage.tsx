import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
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
  Avatar,
  Progress,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Download, Trash2 } from 'lucide-react';
import type { Notice, NoticeRecipient, NoticeTargetType, PaginatedResponse, User, Role, Department, NoticeReadStats } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { formatDateTime } from '@/utils/date';
import { useDictItems } from '@/hooks/useDictItems';
import DictTag from '@/components/DictTag';
import { usePermission } from '@/hooks/usePermission';

const RichTextEditor = lazy(() => import('@/components/RichTextEditor'));
const editorLoadingFallback = (
  <div
    style={{
      height: 500,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: '1px solid var(--semi-color-border)',
      borderRadius: 4,
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

export default function NoticesPage() {
  const { hasPermission } = usePermission();
  const [data, setData] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const defaultSearchParams: SearchParams = { title: '', type: '', publishStatus: '', timeRange: null };
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingNotice, setEditingNotice] = useState<Notice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formApi, setFormApi] = useState<FormApi | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [contentHtml, setContentHtml] = useState('');
  const [editorKey, setEditorKey] = useState(0);

  // 收件人相关状态
  const [targetType, setTargetType] = useState<NoticeTargetType>('all');
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>([]);
  const [selectedDeptIds, setSelectedDeptIds] = useState<number[]>([]);
  const [userOptions, setUserOptions] = useState<{ value: number; label: string }[]>([]);
  const [roleOptions, setRoleOptions] = useState<{ value: number; label: string }[]>([]);
  const [deptOptions, setDeptOptions] = useState<{ value: number; label: string }[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const userSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { items: typeItems } = useDictItems('notice_type');
  const { items: statusItems } = useDictItems('notice_publish_status');
  const { items: priorityItems } = useDictItems('notice_priority');

  // ─── 已读统计 ─────────────────────────────────────────────────────────────────────────────
  const [statsDrawerVisible, setStatsDrawerVisible] = useState(false);
  const [statsNotice, setStatsNotice] = useState<Notice | null>(null);
  const [statsData, setStatsData] = useState<NoticeReadStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsTab, setStatsTab] = useState<'read' | 'unread'>('read');

  const fetchData = useCallback(async (p = page, ps = pageSize, params = submittedParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.title ? { title: params.title } : {}),
        ...(params.type ? { type: params.type } : {}),
        ...(params.publishStatus ? { publishStatus: params.publishStatus } : {}),
        ...(params.timeRange
          ? {
            startTime: params.timeRange[0].toISOString(),
            endTime: params.timeRange[1].toISOString(),
          }
          : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<Notice>>(`/api/notices?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
        setPage(res.data.page);
        setPageSize(res.data.pageSize);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, submittedParams]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = () => {
    setSubmittedParams({ ...searchParams });
    setPage(1);
    fetchData(1, pageSize, searchParams);
  };

  const handleReset = () => {
    const empty = defaultSearchParams;
    setSearchParams(empty);
    setSubmittedParams(empty);
    setPage(1);
    fetchData(1, pageSize, empty);
  };

  const fetchStatsData = async (notice: Notice, page: number, tab: 'read' | 'unread') => {
    setStatsLoading(true);
    try {
      const res = await request.get<NoticeReadStats>(
        `/api/notices/${notice.id}/read-stats?tab=${tab}&page=${page}&pageSize=10`,
      );
      if (res.code === 0) setStatsData(res.data);
    } finally {
      setStatsLoading(false);
    }
  };

  const openStatsDrawer = (notice: Notice) => {
    setStatsNotice(notice);
    setStatsTab('read');
    setStatsData(null);
    setStatsDrawerVisible(true);
    void fetchStatsData(notice, 1, 'read');
  };

  const loadRecipientOptions = async () => {
    setLoadingOptions(true);
    try {
      const [rolesRes, deptsRes] = await Promise.all([
        request.get<Role[]>('/api/roles'),
        request.get<Department[]>('/api/departments/flat'),
      ]);
      if (rolesRes.code === 0) {
        setRoleOptions(rolesRes.data.map((r) => ({ value: r.id, label: r.name })));
      }
      if (deptsRes.code === 0) {
        setDeptOptions(deptsRes.data.map((d) => ({ value: d.id, label: d.name })));
      }
    } finally {
      setLoadingOptions(false);
    }
  };

  const handleUserSearch = (keyword: string) => {
    if (userSearchTimer.current) clearTimeout(userSearchTimer.current);
    if (!keyword.trim()) return;
    const trimmed = keyword.trim();
    const currentSelectedIds = [...selectedUserIds];
    userSearchTimer.current = setTimeout(() => {
      void doFetchUsers(trimmed, currentSelectedIds);
    }, 300);
  };

  const doFetchUsers = async (keyword: string, currentSelectedIds: number[]) => {
    const res = await request.get<PaginatedResponse<User>>(
      `/api/users?page=1&pageSize=20&username=${encodeURIComponent(keyword)}`,
    );
    if (res.code !== 0) return;
    const newResults = res.data.list.map((u) => ({ value: u.id, label: `${u.nickname}（${u.username}）` }));
    setUserOptions((prev) => mergeUserOptions(prev, newResults, new Set(currentSelectedIds)));
  };

  const openCreateModal = () => {
    setEditingNotice(null);
    setContentHtml('');
    setEditorKey((k) => k + 1);
    setTargetType('all');
    setSelectedUserIds([]);
    setSelectedRoleIds([]);
    setSelectedDeptIds([]);
    setUserOptions([]);
    void loadRecipientOptions();
    setModalVisible(true);
  };

  const openEditModal = async (record: Notice) => {
    setContentHtml(record.content ?? '');
    setEditorKey((k) => k + 1);
    setEditingNotice(record);
    setTargetType('all');
    setSelectedUserIds([]);
    setSelectedRoleIds([]);
    setSelectedDeptIds([]);
    setUserOptions([]);
    setModalVisible(true);

    // 异步加载选项和收件人详情
    const [, detailRes] = await Promise.all([
      loadRecipientOptions(),
      request.get<Notice & { recipients: NoticeRecipient[] }>(`/api/notices/${record.id}`),
    ]);

    if (detailRes.code === 0 && detailRes.data) {
      const { targetType: t, recipients = [] } = detailRes.data;
      setTargetType(t ?? 'all');
      setSelectedUserIds(recipients.filter((r) => r.recipientType === 'user').map((r) => r.recipientId));
      setSelectedRoleIds(recipients.filter((r) => r.recipientType === 'role').map((r) => r.recipientId));
      setSelectedDeptIds(recipients.filter((r) => r.recipientType === 'dept').map((r) => r.recipientId));
      // 预填用户选项（含 label）
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
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete<null>(`/api/notices/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      fetchData(page, pageSize, submittedParams);
    }
  };

  const handleBatchDelete = () => {
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 条通知？`,
      content: '删除后无法恢复，请确认操作',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete<null>('/api/notices/batch', { ids: selectedRowKeys });
        if (res.code === 0) {
          Toast.success(res.message ?? '删除成功');
          setSelectedRowKeys([]);
          fetchData(1, pageSize, submittedParams);
        }
      },
    });
  };

  const handleSubmit = async () => {
    if (!formApi) return;
    let values: Record<string, unknown>;
    try {
      values = await formApi.validate();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const isContentEmpty = !contentHtml || contentHtml === '<p><br></p>';
      if (isContentEmpty) {
        Toast.warning('请输入通知内容');
        setSubmitting(false);
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
      const payload = {
        title: values.title,
        content: contentHtml,
        type: values.type || 'notice',
        publishStatus: values.publishStatus || 'draft',
        priority: values.priority || 'medium',
        targetType,
        recipients,
      };
      let res;
      if (editingNotice) {
        res = await request.put<Notice>(`/api/notices/${editingNotice.id}`, payload);
      } else {
        res = await request.post<Notice>('/api/notices', payload);
      }
      if (res.code === 0) {
        Toast.success(editingNotice ? '更新成功' : '创建成功');
        setModalVisible(false);
        fetchData(editingNotice ? page : 1, pageSize, submittedParams);
      }
    } finally {
      setSubmitting(false);
    }
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
        render: (_: unknown, u: NoticeReadStats['list'][number]) => (
          <Space>
            <Avatar size="extra-extra-small" src={u.avatar ?? undefined}>
              {u.nickname?.[0] ?? 'U'}
            </Avatar>
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
            if (statsNotice) void fetchStatsData(statsNotice, 1, t);
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
                currentPage: statsData.page,
                pageSize: statsData.pageSize,
                onPageChange: (p: number) => {
                  if (statsNotice) void fetchStatsData(statsNotice, p, 'read');
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
                currentPage: statsData.page,
                pageSize: statsData.pageSize,
                onPageChange: (p: number) => {
                  if (statsNotice) void fetchStatsData(statsNotice, p, 'unread');
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
  };

  const columns: ColumnProps<Notice>[] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '标题', dataIndex: 'title', width: 220, ellipsis: true },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (v: string) => <DictTag dictCode="notice_type" value={v} />,
    },
    {
      title: '发布状态',
      dataIndex: 'publishStatus',
      width: 110,
      render: (v: string) => {
        const item = statusItems.find((i) => i.value === v);
        return <Tag color={publishStatusColorMap[v] as 'grey' | 'green' | 'orange'}>{item?.label ?? v}</Tag>;
      },
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 100,
      render: (v: string) => <DictTag dictCode="notice_priority" value={v} />,
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
      render: (v: number, record: Notice) => {
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
      width: 170,
      render: (v: string | null) => (v ? formatDateTime(v) : '-'),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '操作',
      dataIndex: 'op',
      width: 180,
      fixed: 'right' as const,
      render: (_: unknown, record: Notice) => (
        <Space>
          {hasPermission('system:notice:update') && <Button
            theme="borderless"
            size="small"
            onClick={() => openEditModal(record)}
          >编辑</Button>}
          {hasPermission('system:notice:delete') && <Button theme="borderless" type="danger" size="small" onClick={() => {
            Modal.confirm({
              title: '确定要删除该通知吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          }}>删除</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        left={<>
          <Input
            prefix={<Search size={14} />}
            placeholder="搜索标题"
            value={searchParams.title}
            onChange={(v) => setSearchParams((prev) => ({ ...prev, title: v }))}
            onEnterPress={handleSearch}
            style={{ width: 200 }}
            showClear
          />
          <Select
            placeholder="通知类型"
            value={searchParams.type || undefined}
            onChange={(v) => setSearchParams((prev) => ({ ...prev, type: typeof v === 'string' ? v : '' }))}
            optionList={typeItems.map((i) => ({ label: i.label, value: i.value }))}
            showClear
            style={{ width: 140 }}
          />
          <Select
            placeholder="发布状态"
            value={searchParams.publishStatus || undefined}
            onChange={(v) => setSearchParams((prev) => ({ ...prev, publishStatus: typeof v === 'string' ? v : '' }))}
            optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))}
            showClear
            style={{ width: 140 }}
          />
          <DatePicker
            type="dateTimeRange"
            placeholder={["开始时间", "结束时间"]}
            value={searchParams.timeRange ?? undefined}
            onChange={(v) => setSearchParams((prev) => ({ ...prev, timeRange: v ? (v as [Date, Date]) : null }))}
            style={{ width: 360 }}
          />
          <Button icon={<Search size={14} />} type="primary" onClick={handleSearch}>查询</Button>
          <Button icon={<RotateCcw size={14} />} type="tertiary" onClick={handleReset}>重置</Button>
        </>}
        right={<Space>
          <Button icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/notices/export', '通知列表.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
          {selectedRowKeys.length > 0 && hasPermission('system:notice:delete') && (
            <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
              批量删除 ({selectedRowKeys.length})
            </Button>
          )}
          {hasPermission('system:notice:create') && <Button icon={<Plus size={14} />} type="secondary" onClick={openCreateModal}>新增</Button>}
        </Space>}
      />

      <Table
        bordered
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        scroll={{ x: 1520 }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
        }}
        pagination={{
          total,
          currentPage: page,
          pageSize,
          showSizeChanger: true,
          pageSizeOpts: [10, 20, 50],
          onPageChange: (p: number) => {
            setPage(p);
            void fetchData(p, pageSize, submittedParams);
          },
          onPageSizeChange: (ps: number) => {
            setPageSize(ps);
            setPage(1);
            void fetchData(1, ps, submittedParams);
          },
        }}
      />

      <SideSheet
        title={editingNotice ? '编辑通知' : '新增通知'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        width={860}
        afterVisibleChange={(visible) => { if (!visible) formApi?.reset(); }}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setModalVisible(false)}>取消</Button>
            <Button type="primary" loading={submitting} onClick={handleSubmit}>
              {editingNotice ? '保存' : '创建'}
            </Button>
          </div>
        }
      >
        <Form
          getFormApi={(api) => setFormApi(api)}
          layout="vertical"
          initValues={
            editingNotice
              ? {
                title: editingNotice.title,
                type: editingNotice.type,
                publishStatus: editingNotice.publishStatus,
                priority: editingNotice.priority,
              }
              : { type: 'notice', publishStatus: 'draft', priority: 'medium' }
          }
        >
          <Form.Input
            field="title"
            label="标题"
            placeholder="请输入通知标题"
            rules={[{ required: true, message: '标题不能为空' }]}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            <Form.Select
              field="type"
              label="通知类型"
              optionList={typeItems.map((i) => ({ label: i.label, value: i.value }))}
              placeholder="请选择类型"
              style={{ width: '100%' }}
            />
            <Form.Select
              field="publishStatus"
              label="发布状态"
              optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))}
              placeholder="请选择状态"
              style={{ width: '100%' }}
            />
            <Form.Select
              field="priority"
              label="优先级"
              optionList={priorityItems.map((i) => ({ label: i.label, value: i.value }))}
              placeholder="请选择优先级"
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 500 }}>收件对象</div>
            <RadioGroup
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as NoticeTargetType)}
              style={{ marginBottom: targetType === 'specific' ? 12 : 0 }}
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
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--semi-color-text-1)' }}>角色</div>
                  <Select
                    multiple
                    showClear
                    filter
                    loading={loadingOptions}
                    placeholder="请选择角色"
                    value={selectedRoleIds}
                    optionList={roleOptions}
                    onChange={(v) => setSelectedRoleIds(v as number[])}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--semi-color-text-1)' }}>部门</div>
                  <Select
                    multiple
                    showClear
                    filter
                    loading={loadingOptions}
                    placeholder="请选择部门"
                    value={selectedDeptIds}
                    optionList={deptOptions}
                    onChange={(v) => setSelectedDeptIds(v as number[])}
                    style={{ width: '100%' }}
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
                  placeholder="请输入通知内容"
                  height={500}
                />
              </Suspense>
            ) : null}
          </div>
        </Form>
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
