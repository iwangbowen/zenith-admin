import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, Modal, Form, Toast, Tag, Spin, Row, Col, Dropdown } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, Plus, RotateCcw, KeyRound, ChevronDown, Tags } from 'lucide-react';
import type { Member, MemberTag } from '@zenith/shared';
import { MEMBER_STATUS_LABELS } from '@zenith/shared';
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
import { MemberTagsManageModal } from './MemberTagsManageModal';
import {
  memberAdminKeys,
  useAdjustMemberGrowth,
  useBatchMemberLevel,
  useBatchMemberStatus,
  useBatchMemberTags,
  useDeleteMember,
  useMemberLevels,
  useMemberList,
  useMemberTags,
  useResetMemberPassword,
  useSaveMember,
  useSetMemberTags,
} from '@/hooks/queries/member-admin';

const STATUS_COLORS: Record<string, 'green' | 'grey' | 'red'> = { active: 'green', inactive: 'grey', banned: 'red' };
const statusOptions = (['active', 'inactive', 'banned'] as const).map((v) => ({ value: v, label: MEMBER_STATUS_LABELS[v] }));
const TAG_FALLBACK_COLOR = 'blue';

interface SearchParams { keyword: string; status: string; levelId?: number; tagId?: number }
const defaultSearch: SearchParams = { keyword: '', status: '', levelId: undefined, tagId: undefined };

export default function MembersPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const pwdFormApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [pwdVisible, setPwdVisible] = useState(false);
  const [pwdMember, setPwdMember] = useState<Member | null>(null);
  const [growthVisible, setGrowthVisible] = useState(false);
  const [growthMember, setGrowthMember] = useState<Member | null>(null);
  const growthFormApi = useRef<FormApi | null>(null);
  // member tags
  const [tagsMember, setTagsMember] = useState<Member | null>(null);
  const [tagsDraft, setTagsDraft] = useState<number[]>([]);
  const [tagsManageVisible, setTagsManageVisible] = useState(false);
  const [batchTagsVisible, setBatchTagsVisible] = useState(false);
  const [batchTagIds, setBatchTagIds] = useState<number[]>([]);
  // batch operations
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [batchStatusVisible, setBatchStatusVisible] = useState(false);
  const [batchLevelVisible, setBatchLevelVisible] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string>('');
  const [batchLevelId, setBatchLevelId] = useState<number | undefined>(undefined);
  // detail drawer
  const [detailMemberId, setDetailMemberId] = useState<number | null>(null);
  const listQuery = useMemberList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    levelId: submittedParams.levelId,
    tagId: submittedParams.tagId,
  });
  const levelsQuery = useMemberLevels();
  const tagsQuery = useMemberTags();
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const levels = levelsQuery.data ?? [];
  const memberTags = tagsQuery.data ?? [];
  const enabledTags = memberTags.filter((t: MemberTag) => t.status === 'enabled');
  const saveMutation = useSaveMember();
  const deleteMutation = useDeleteMember();
  const resetPasswordMutation = useResetMemberPassword();
  const adjustGrowthMutation = useAdjustMemberGrowth();
  const batchStatusMutation = useBatchMemberStatus();
  const batchLevelMutation = useBatchMemberLevel();
  const setTagsMutation = useSetMemberTags();
  const batchTagsMutation = useBatchMemberTags();

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: memberAdminKeys.memberLists });
  };
  const handleReset = () => {
    setDraftParams(defaultSearch);
    setSubmittedParams(defaultSearch);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: memberAdminKeys.memberLists });
  };

  const buildExportQuery = () => {
    const ap = submittedParams;
    return {
      ...(ap.keyword ? { keyword: ap.keyword } : {}),
      ...(ap.status ? { status: ap.status } : {}),
      ...(ap.levelId ? { levelId: String(ap.levelId) } : {}),
      ...(ap.tagId ? { tagId: String(ap.tagId) } : {}),
    };
  };

  const openCreate = () => { setEditing(null); setModalVisible(true); };
  const openEdit = (record: Member) => { setEditing(record); setModalVisible(true); };

  const handleModalOk = async () => {
    let values;
    try { values = await formApi.current!.validate(); } catch { throw new Error('validation'); }
    await saveMutation.mutateAsync({ id: editing?.id, values });
    Toast.success(editing ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditing(null);
  };

  const handleDelete = (record: Member) => {
    Modal.confirm({
      title: `确认删除会员「${record.nickname}」？`,
      content: '删除后该会员将无法登录、不再出现在列表中；其积分/钱包流水、券码与签到记录将保留用于审计对账。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(record.id);
        Toast.success('删除成功');
      },
    });
  };

  const openAdjustGrowth = (record: Member) => { setGrowthMember(record); setGrowthVisible(true); };
  const handleAdjustGrowth = async () => {
    let values;
    try { values = await growthFormApi.current!.validate(); } catch { throw new Error('validation'); }
    if (!growthMember) return;
    await adjustGrowthMutation.mutateAsync({ id: growthMember.id, values: values as { delta: number; remark?: string } });
    Toast.success('成长值已调整');
    setGrowthVisible(false);
    setGrowthMember(null);
  };

  // ── 标签操作 ──────────────────────────────────────────────────────────────
  const openSetTags = (record: Member) => {
    setTagsMember(record);
    setTagsDraft((record.tags ?? []).map((t) => t.id));
  };
  const handleSetTags = async () => {
    if (!tagsMember) return;
    await setTagsMutation.mutateAsync({ id: tagsMember.id, tagIds: tagsDraft });
    Toast.success('标签已更新');
    setTagsMember(null);
  };
  const handleBatchTags = async () => {
    if (batchTagIds.length === 0) return;
    await batchTagsMutation.mutateAsync({ ids: selectedRowKeys, tagIds: batchTagIds });
    Toast.success('已批量打标签');
    setBatchTagsVisible(false);
    setBatchTagIds([]);
    setSelectedRowKeys([]);
  };

  const openResetPwd = (record: Member) => { setPwdMember(record); setPwdVisible(true); };
  const handleResetPwd = async () => {
    let values;
    try { values = await pwdFormApi.current!.validate(); } catch { throw new Error('validation'); }
    if (!pwdMember) return;
    await resetPasswordMutation.mutateAsync({ id: pwdMember.id, values });
    Toast.success('密码已重置');
    setPwdVisible(false);
    setPwdMember(null);
  };

  // ── 批量操作 ──────────────────────────────────────────────────────────────
  const handleBatchStatus = async () => {
    if (!batchStatus) return;
    await batchStatusMutation.mutateAsync({ ids: selectedRowKeys, status: batchStatus });
    Toast.success('已更新');
    setBatchStatusVisible(false);
    setBatchStatus('');
    setSelectedRowKeys([]);
  };

  const handleBatchLevel = async () => {
    await batchLevelMutation.mutateAsync({ ids: selectedRowKeys, levelId: batchLevelId ?? null });
    Toast.success('已更新');
    setBatchLevelVisible(false);
    setBatchLevelId(undefined);
    setSelectedRowKeys([]);
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
    {
      title: '标签', dataIndex: 'tags', width: 160,
      render: (v?: Member['tags']) => (v && v.length > 0
        ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{v.map((t) => <Tag key={t.id} size="small" color={(t.color || TAG_FALLBACK_COLOR) as 'blue'}>{t.name}</Tag>)}</div>
        : '-'),
    },
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
        { key: 'set-tags', label: '设置标签', hidden: !hasPermission('member:member:update'), onClick: () => openSetTags(record) },
        { key: 'adjust-growth', label: '调整成长值', hidden: !hasPermission('member:member:update'), onClick: () => openAdjustGrowth(record) },
        { key: 'reset-password', label: '重置密码', hidden: !hasPermission('member:member:update'), onClick: () => openResetPwd(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !hasPermission('member:member:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="昵称/手机号/用户名/邮箱"
      value={draftParams.keyword}
      showClear
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      onEnterPress={handleSearch}
      style={{ width: 240 }}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={draftParams.status || undefined}
      style={{ width: 130 }}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      optionList={[{ value: '', label: '全部状态' }, ...statusOptions]}
    />
  );

  const renderLevelFilter = () => (
    <Select
      placeholder="全部等级"
      value={draftParams.levelId}
      style={{ width: 140 }}
      showClear
      onChange={(v) => setDraftParams((p) => ({ ...p, levelId: v as number | undefined }))}
      optionList={levels.map((l) => ({ value: l.id, label: l.name }))}
    />
  );

  const renderTagFilter = () => (
    <Select
      placeholder="全部标签"
      value={draftParams.tagId}
      style={{ width: 140 }}
      showClear
      onChange={(v) => setDraftParams((p) => ({ ...p, tagId: v as number | undefined }))}
      optionList={memberTags.map((t: MemberTag) => ({ value: t.id, label: t.name }))}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => hasPermission('member:member:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;
  const renderTagsManageButton = () => hasPermission('member:member:update') ? (
    <Button type="tertiary" icon={<Tags size={14} />} onClick={() => setTagsManageVisible(true)}>标签管理</Button>
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
            {renderTagFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderExportButtons()}
            {renderTagsManageButton()}
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
            {renderTagFilter()}
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
          <Button size="small" type="primary" theme="light" onClick={() => setBatchTagsVisible(true)}>批量打标签</Button>
          <Button size="small" type="tertiary" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
        </div>
      )}

      <ConfigurableTable bordered columns={columns} dataSource={data} loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} rowKey="id" size="small"
        rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys as number[]) }}
        pagination={buildPagination(total)} empty="暂无数据" />

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

      {/* 调整成长值 Modal */}
      <AppModal title="调整成长值" visible={growthVisible} width={480}
        okButtonProps={{ loading: adjustGrowthMutation.isPending }}
        onCancel={() => { setGrowthVisible(false); setGrowthMember(null); }} onOk={handleAdjustGrowth}>
        <p style={{ marginBottom: 12, fontSize: 13, color: '#6b7280' }}>
          会员「{growthMember?.nickname}」当前成长值 <strong>{growthMember?.growthValue ?? 0}</strong>，
          调整后将按等级门槛自动重新定级。
        </p>
        <Form key={growthMember?.id ?? 'growth'} getFormApi={(api) => { growthFormApi.current = api; }}
          labelPosition="left" labelWidth={90}>
          <Form.InputNumber field="delta" label="变动量" style={{ width: '100%' }}
            placeholder="正数增加，负数扣减" precision={0}
            rules={[
              { required: true, message: '请输入变动量' },
              { validator: (_r, v) => v !== 0, message: '变动量不能为 0' },
            ]} />
          <Form.Input field="remark" label="调整原因" placeholder="选填，将记入操作审计" maxLength={256} />
        </Form>
      </AppModal>

      {/* 批量更改状态确认 Modal */}
      <AppModal
        title="批量更改状态"
        visible={batchStatusVisible}
        okButtonProps={{ loading: batchStatusMutation.isPending }}
        onOk={handleBatchStatus}
        onCancel={() => { setBatchStatusVisible(false); setBatchStatus(''); }}
        width={460}
      >
        <p>确认将 <strong>{selectedRowKeys.length}</strong> 名会员状态更改为「{MEMBER_STATUS_LABELS[batchStatus as keyof typeof MEMBER_STATUS_LABELS]}」吗？</p>
        {batchStatus !== 'active' && <p style={{ color: '#fa5151', fontSize: 13 }}>注意：非正常状态的会员将被强制下线。</p>}
      </AppModal>

      {/* 批量调整等级 Modal */}
      <AppModal
        title="批量调整等级"
        visible={batchLevelVisible}
        okButtonProps={{ loading: batchLevelMutation.isPending }}
        onOk={handleBatchLevel}
        onCancel={() => { setBatchLevelVisible(false); setBatchLevelId(undefined); }}
        width={460}
      >
        <p>将 <strong>{selectedRowKeys.length}</strong> 名会员等级调整为：</p>
        <Select
          value={batchLevelId}
          onChange={(v) => setBatchLevelId(v as number | undefined)}
          optionList={[{ value: undefined, label: '无等级（清除）' }, ...levels.map((l) => ({ value: l.id, label: l.name }))]}
          style={{ width: '100%', marginTop: 8 }}
          placeholder="请选择等级"
        />
      </AppModal>

      {/* 设置标签 Modal */}
      <AppModal title="设置会员标签" visible={!!tagsMember} width={480}
        okButtonProps={{ loading: setTagsMutation.isPending }}
        onCancel={() => setTagsMember(null)} onOk={handleSetTags}>
        <p style={{ marginBottom: 12, fontSize: 13, color: '#6b7280' }}>
          为会员「{tagsMember?.nickname}」设置标签（覆盖原有标签）：
        </p>
        <Select multiple filter placeholder="选择标签" value={tagsDraft} style={{ width: '100%' }}
          onChange={(v) => setTagsDraft((v as number[]) ?? [])}
          optionList={enabledTags.map((t: MemberTag) => ({ value: t.id, label: t.name }))} />
      </AppModal>

      {/* 批量打标签 Modal */}
      <AppModal title="批量打标签" visible={batchTagsVisible} width={480}
        okButtonProps={{ loading: batchTagsMutation.isPending, disabled: batchTagIds.length === 0 }}
        onCancel={() => { setBatchTagsVisible(false); setBatchTagIds([]); }} onOk={handleBatchTags}>
        <p style={{ marginBottom: 12 }}>为已选 <strong>{selectedRowKeys.length}</strong> 名会员追加标签（已有标签保留）：</p>
        <Select multiple filter placeholder="选择标签" value={batchTagIds} style={{ width: '100%' }}
          onChange={(v) => setBatchTagIds((v as number[]) ?? [])}
          optionList={enabledTags.map((t: MemberTag) => ({ value: t.id, label: t.name }))} />
      </AppModal>

      {/* 标签管理 Modal */}
      <MemberTagsManageModal visible={tagsManageVisible} onClose={() => setTagsManageVisible(false)} />

      {/* 会员详情侧滑 */}
      <MemberDetailDrawer memberId={detailMemberId} onClose={() => setDetailMemberId(null)} />
    </div>
  );
}
