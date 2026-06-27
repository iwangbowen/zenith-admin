import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Select, Modal, Form, Toast, Tag, Spin, Row, Col, Dropdown } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, Plus, RotateCcw, KeyRound, ChevronDown } from 'lucide-react';
import type { Member, MemberLevel, PaginatedResponse } from '@zenith/shared';
import { MEMBER_STATUS_LABELS } from '@zenith/shared';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { UserAvatar } from '@/components/UserAvatar';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { MemberDetailDrawer } from './MemberDetailDrawer';

const STATUS_COLORS: Record<string, 'green' | 'grey' | 'red'> = { active: 'green', inactive: 'grey', banned: 'red' };
const statusOptions = (['active', 'inactive', 'banned'] as const).map((v) => ({ value: v, label: MEMBER_STATUS_LABELS[v] }));

interface SearchParams { keyword: string; status: string; levelId?: number }
const defaultSearch: SearchParams = { keyword: '', status: '', levelId: undefined };

export default function MembersPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const pwdFormApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [search, setSearch] = useState<SearchParams>(defaultSearch);
  const searchRef = useRef<SearchParams>(defaultSearch);
  searchRef.current = search;
  const [levels, setLevels] = useState<MemberLevel[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [pwdVisible, setPwdVisible] = useState(false);
  const [pwdMember, setPwdMember] = useState<Member | null>(null);
  // batch operations
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [batchStatusVisible, setBatchStatusVisible] = useState(false);
  const [batchLevelVisible, setBatchLevelVisible] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string>('');
  const [batchLevelId, setBatchLevelId] = useState<number | undefined>(undefined);
  const [batchLoading, setBatchLoading] = useState(false);
  // detail drawer
  const [detailMemberId, setDetailMemberId] = useState<number | null>(null);

  const fetchData = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const ap = params ?? searchRef.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({
        page: String(p), pageSize: String(ps),
        ...(ap.keyword ? { keyword: ap.keyword } : {}),
        ...(ap.status ? { status: ap.status } : {}),
        ...(ap.levelId ? { levelId: String(ap.levelId) } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<Member>>(`/api/members?${q}`);
      if (res.code === 0) { setData(res.data.list); setTotal(res.data.total); }
    } finally { setLoading(false); }
  }, [page, pageSize]);

  useEffect(() => { void fetchData(); }, [fetchData]);
  useEffect(() => {
    void (async () => {
      const res = await request.get<MemberLevel[]>('/api/member-levels');
      if (res.code === 0) setLevels(res.data);
    })();
  }, []);

  const handleSearch = () => { setPage(1); void fetchData(1, pageSize); };
  const handleReset = () => { setSearch(defaultSearch); setPage(1); void fetchData(1, pageSize, defaultSearch); };

  const buildExportQuery = () => {
    const ap = searchRef.current;
    return {
      ...(ap.keyword ? { keyword: ap.keyword } : {}),
      ...(ap.status ? { status: ap.status } : {}),
      ...(ap.levelId ? { levelId: String(ap.levelId) } : {}),
    };
  };

  const openCreate = () => { setEditing(null); setModalVisible(true); };
  const openEdit = (record: Member) => { setEditing(record); setModalVisible(true); };

  const handleModalOk = async () => {
    let values;
    try { values = await formApi.current?.validate(); } catch { throw new Error('validation'); }
    const res = editing
      ? await request.put(`/api/members/${editing.id}`, values)
      : await request.post('/api/members', values);
    if (res.code === 0) {
      Toast.success(editing ? '更新成功' : '创建成功');
      setModalVisible(false); setEditing(null); void fetchData();
    } else { throw new Error(res.message); }
  };

  const handleDelete = (record: Member) => {
    Modal.confirm({
      title: `确认删除会员「${record.nickname}」？`,
      content: '会员的积分、钱包、优惠券将一并删除，且无法恢复。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete(`/api/members/${record.id}`);
        if (res.code === 0) { Toast.success('删除成功'); void fetchData(); }
      },
    });
  };

  const openResetPwd = (record: Member) => { setPwdMember(record); setPwdVisible(true); };
  const handleResetPwd = async () => {
    let values;
    try { values = await pwdFormApi.current?.validate(); } catch { throw new Error('validation'); }
    if (!pwdMember) return;
    const res = await request.post(`/api/members/${pwdMember.id}/reset-password`, values);
    if (res.code === 0) { Toast.success('密码已重置'); setPwdVisible(false); setPwdMember(null); }
    else throw new Error(res.message);
  };

  // ── 批量操作 ──────────────────────────────────────────────────────────────
  const handleBatchStatus = async () => {
    if (!batchStatus) return;
    setBatchLoading(true);
    try {
      const res = await request.put('/api/members/batch-status', { ids: selectedRowKeys, status: batchStatus });
      if (res.code === 0) {
        Toast.success(res.message ?? '已更新');
        setBatchStatusVisible(false); setBatchStatus(''); setSelectedRowKeys([]);
        void fetchData();
      } else throw new Error(res.message);
    } finally { setBatchLoading(false); }
  };

  const handleBatchLevel = async () => {
    setBatchLoading(true);
    try {
      const res = await request.put('/api/members/batch-level', { ids: selectedRowKeys, levelId: batchLevelId ?? null });
      if (res.code === 0) {
        Toast.success(res.message ?? '已更新');
        setBatchLevelVisible(false); setBatchLevelId(undefined); setSelectedRowKeys([]);
        void fetchData();
      } else throw new Error(res.message);
    } finally { setBatchLoading(false); }
  };

  const formInit = editing
    ? { nickname: editing.nickname, phone: editing.phone, email: editing.email, gender: editing.gender, levelId: editing.levelId, status: editing.status, remark: editing.remark }
    : { status: 'active' as const };

  const columns: ColumnProps<Member>[] = [
    {
      title: '昵称', dataIndex: 'nickname', width: 180,
      render: (v: string, record: Member) => (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minWidth: 0 }}
          onClick={() => setDetailMemberId(record.id)}
        >
          <UserAvatar name={v || record.username || '?'} avatar={record.avatar} semiSize="extra-small" size={24} />
          <span className="table-cell-ellipsis" title={v}>{v}</span>
        </div>
      ),
    },
    { title: '用户名', dataIndex: 'username', width: 120, render: (v: string | null) => v || '-' },
    { title: '手机号', dataIndex: 'phone', width: 130, render: (v: string | null) => v || '-' },
    { title: '邮箱', dataIndex: 'email', width: 180, render: renderEllipsis },
    { title: '等级', dataIndex: 'levelName', width: 100, render: (v: string | null) => (v ? <Tag color="amber">{v}</Tag> : '-') },
    { title: '积分', dataIndex: 'pointBalance', width: 90, render: (v?: number) => v ?? 0 },
    { title: '余额(元)', dataIndex: 'walletBalance', width: 100, render: (v?: number) => ((v ?? 0) / 100).toFixed(2) },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: string) => <Tag color={STATUS_COLORS[v]}>{MEMBER_STATUS_LABELS[v as keyof typeof MEMBER_STATUS_LABELS]}</Tag>,
    },
    createOperationColumn<Member>({
      width: 200,
      desktopInlineKeys: ['detail', 'edit'],
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => setDetailMemberId(record.id) },
        { key: 'edit', label: '编辑', hidden: !hasPermission('member:member:update'), onClick: () => openEdit(record) },
        { key: 'reset-password', label: '重置密码', hidden: !hasPermission('member:member:update'), onClick: () => openResetPwd(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !hasPermission('member:member:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="昵称/手机号/用户名/邮箱"
      value={search.keyword}
      showClear
      onChange={(v) => setSearch((p) => ({ ...p, keyword: v }))}
      onEnterPress={handleSearch}
      style={{ width: 240 }}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={search.status || undefined}
      style={{ width: 130 }}
      onChange={(v) => setSearch((p) => ({ ...p, status: (v as string) ?? '' }))}
      optionList={[{ value: '', label: '全部状态' }, ...statusOptions]}
    />
  );

  const renderLevelFilter = () => (
    <Select
      placeholder="全部等级"
      value={search.levelId}
      style={{ width: 140 }}
      showClear
      onChange={(v) => setSearch((p) => ({ ...p, levelId: v as number | undefined }))}
      optionList={levels.map((l) => ({ value: l.id, label: l.name }))}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => hasPermission('member:member:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;

  const renderExportButtons = () => hasPermission('member:member:list') ? (
    <ExportButton entity="member.members" query={buildExportQuery()} />
  ) : null;

  const renderMobileExportActions = () => hasPermission('member:member:list') ? (
    <ExportButton entity="member.members" query={buildExportQuery()} variant="flat" />
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderStatusFilter()}
            {renderLevelFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderExportButtons()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderStatusFilter()}
            {renderLevelFilter()}
          </>
        )}
        mobileActions={renderMobileExportActions()}
        filterTitle="会员筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {/* 批量操作栏 */}
      {selectedRowKeys.length > 0 && hasPermission('member:member:update') && (
        <div style={{ padding: '8px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>已选 <strong>{selectedRowKeys.length}</strong> 名会员</span>
          <Dropdown
            trigger="click"
            render={
              <Dropdown.Menu>
                {statusOptions.map((s) => (
                  <Dropdown.Item key={s.value} onClick={() => { setBatchStatus(s.value); setBatchStatusVisible(true); }}>
                    更改为「{s.label}」
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            }
          >
            <Button size="small" type="primary" theme="light" icon={<ChevronDown size={13} />} iconPosition="right">批量更改状态</Button>
          </Dropdown>
          <Button size="small" type="primary" theme="light" onClick={() => setBatchLevelVisible(true)}>批量调整等级</Button>
          <Button size="small" type="tertiary" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
        </div>
      )}

      <ConfigurableTable bordered columns={columns} dataSource={data} loading={loading}
        onRefresh={fetchData} refreshLoading={loading} rowKey="id" size="small"
        rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys as number[]) }}
        pagination={buildPagination(total, fetchData)} empty="暂无数据" />

      {/* 编辑 / 新增 Modal */}
      <AppModal title={editing ? '编辑会员' : '新增会员'} visible={modalVisible} width={660}
        onCancel={() => { setModalVisible(false); setEditing(null); }} onOk={handleModalOk}>
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} allowEmpty
          initValues={formInit} labelPosition="left" labelWidth={90}>
          <Row gutter={16}>
            <Col span={12}><Form.Input field="nickname" label="昵称" placeholder="请输入昵称" rules={[{ required: true, message: '请输入昵称' }]} /></Col>
            <Col span={12}><Form.Input field="username" label="用户名" placeholder="选填" disabled={!!editing} /></Col>
            <Col span={12}><Form.Input field="phone" label="手机号" placeholder="选填" /></Col>
            <Col span={12}><Form.Input field="email" label="邮箱" placeholder="选填" /></Col>
            {!editing && <Col span={12}><Form.Input field="password" label="密码" type="password" placeholder="选填，留空则无密码" /></Col>}
            <Col span={12}>
              <Form.Select field="levelId" label="会员等级" placeholder="请选择" style={{ width: '100%' }} showClear
                optionList={levels.map((l) => ({ value: l.id, label: l.name }))} />
            </Col>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusOptions} />
            </Col>
            <Col span={12}>
              <Form.Select field="gender" label="性别" placeholder="请选择" style={{ width: '100%' }} showClear
                optionList={[{ value: 'male', label: '男' }, { value: 'female', label: '女' }]} />
            </Col>
          </Row>
          <Form.TextArea field="remark" label="备注" placeholder="请输入备注" maxCount={256} />
        </Form>
      </AppModal>

      {/* 重置密码 Modal */}
      <AppModal title="重置会员密码" visible={pwdVisible} width={480}
        onCancel={() => { setPwdVisible(false); setPwdMember(null); }} onOk={handleResetPwd}>
        <Spin spinning={false}>
          <Form getFormApi={(api) => { pwdFormApi.current = api; }} labelPosition="left" labelWidth={90}>
            <Form.Input field="newPassword" label="新密码" type="password" prefix={<KeyRound size={14} />}
              placeholder="请输入新密码（至少6位）" rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '至少6位' }]} />
          </Form>
        </Spin>
      </AppModal>

      {/* 批量更改状态确认 Modal */}
      <Modal
        title="批量更改状态"
        visible={batchStatusVisible}
        confirmLoading={batchLoading}
        onOk={handleBatchStatus}
        onCancel={() => { setBatchStatusVisible(false); setBatchStatus(''); }}
      >
        <p>确认将 <strong>{selectedRowKeys.length}</strong> 名会员状态更改为「{MEMBER_STATUS_LABELS[batchStatus as keyof typeof MEMBER_STATUS_LABELS]}」吗？</p>
        {batchStatus !== 'active' && <p style={{ color: '#fa5151', fontSize: 13 }}>注意：非正常状态的会员将被强制下线。</p>}
      </Modal>

      {/* 批量调整等级 Modal */}
      <Modal
        title="批量调整等级"
        visible={batchLevelVisible}
        confirmLoading={batchLoading}
        onOk={handleBatchLevel}
        onCancel={() => { setBatchLevelVisible(false); setBatchLevelId(undefined); }}
      >
        <p>将 <strong>{selectedRowKeys.length}</strong> 名会员等级调整为：</p>
        <Select
          value={batchLevelId}
          onChange={(v) => setBatchLevelId(v as number | undefined)}
          optionList={[{ value: undefined, label: '无等级（清除）' }, ...levels.map((l) => ({ value: l.id, label: l.name }))]}
          style={{ width: '100%', marginTop: 8 }}
          placeholder="请选择等级"
        />
      </Modal>

      {/* 会员详情侧滑 */}
      <MemberDetailDrawer memberId={detailMemberId} onClose={() => setDetailMemberId(null)} />
    </div>
  );
}
