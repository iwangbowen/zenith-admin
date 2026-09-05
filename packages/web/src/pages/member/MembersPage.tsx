import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Select, Form, Toast, Tag, Spin, Row, Col, Dropdown, Modal, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { KeyRound, ChevronDown, Tags } from 'lucide-react';
import type { Member, MemberTag } from '@zenith/shared/member';
import { MEMBER_STATUSES, MEMBER_STATUS_LABELS, type AdjustMemberGrowthInput } from '@zenith/shared/member';
import { enumValueOf } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { UserAvatar } from '@/components/UserAvatar';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import ImportButton from '@/components/ImportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '../../utils/table-columns';
import { MemberDetailDrawer } from './MemberDetailDrawer';
import { MemberTagsManageModal } from './MemberTagsManageModal';
import {
  memberAdminKeys,
  useAdjustMemberGrowth,
  useBatchMemberLevel,
  useBatchMemberStatus,
  useBatchMemberTags,
  useDeleteMembers,
  useMemberLevels,
  useMemberList,
  useMemberTags,
  useResetMemberPassword,
  useSaveMember,
  useSetMemberTags,
  type MemberFormValues,
} from '@/hooks/queries/member-admin';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';

const STATUS_COLORS: Record<string, 'green' | 'grey' | 'red'> = { active: 'green', inactive: 'grey', banned: 'red' };
const statusOptions = (['active', 'inactive', 'banned'] as const).map((v) => ({ value: v, label: MEMBER_STATUS_LABELS[v] }));
const TAG_FALLBACK_COLOR = 'blue';

interface SearchParams { keyword: string; status?: string; levelId?: number; tagId?: number }
const defaultSearch: SearchParams = { keyword: '', status: undefined, levelId: undefined, tagId: undefined };

export default function MembersPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const { items: genderItems } = useDictItems('user_gender');
  const pwdFormApi = useRef<FormApi | null>(null);
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset, applySearch,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: memberAdminKeys.memberLists });
  // 等级列表"会员数"等入口的深链筛选（?levelId=，消费后即从 URL 移除）
  useListDeepLink(['levelId'], (p) => applySearch({ ...defaultSearch, levelId: Number(p.levelId) || undefined }));
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
    status: enumValueOf(MEMBER_STATUSES, submittedParams.status),
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
  const deleteMutation = useDeleteMembers();
  const resetPasswordMutation = useResetMemberPassword();
  const adjustGrowthMutation = useAdjustMemberGrowth();
  const batchStatusMutation = useBatchMemberStatus();
  const batchLevelMutation = useBatchMemberLevel();
  const setTagsMutation = useSetMemberTags();
  const batchTagsMutation = useBatchMemberTags();

  const buildExportQuery = () => {
    const ap = submittedParams;
    return {
      ...(ap.keyword ? { keyword: ap.keyword } : {}),
      ...(ap.status ? { status: ap.status } : {}),
      ...(ap.levelId ? { levelId: String(ap.levelId) } : {}),
      ...(ap.tagId ? { tagId: String(ap.tagId) } : {}),
    };
  };

  const memberModal = useEditModal<Member, MemberFormValues>({
    entityName: '会员',
    save: saveMutation,
    defaults: { status: 'active' as const },
    toValues: (record) => ({ nickname: record.nickname, phone: record.phone, email: record.email, gender: record.gender, levelId: record.levelId, status: record.status, remark: record.remark }),
    beforeSave: (values, ctx) => {
      // 与前台注册契约一致：无任何登录凭证的会员无法登录也无法找回密码
      const username = ctx.editing?.username ?? values.username;
      const { phone, email } = values;
      if (!username?.toString().trim() && !phone?.toString().trim() && !email?.toString().trim()) {
        Toast.warning('用户名、手机号、邮箱至少填写一个，否则该会员将无法登录');
        abortSubmit('validation');
      }
      return values;
    },
  });
  const editing = memberModal.editing;

  const handleDelete = (record: Member) => {
    confirmDelete({
      title: `确认删除会员「${record.nickname}」？`,
      content: '删除后该会员将无法登录、不再出现在列表中；其积分/钱包流水、券码与签到记录将保留用于审计对账。',
      onOk: async () => {
        await deleteMutation.mutateAsync([record.id]);
        Toast.success('删除成功');
      },
    });
  };

  // 封禁/恢复的单行快速切换：风控高频动作，不必进编辑弹窗改状态下拉
  const handleQuickStatus = (record: Member, status: 'active' | 'banned') => {
    const action = status === 'banned' ? '封禁' : '恢复正常';
    Modal.confirm({
      title: `确认${action}会员「${record.nickname}」？`,
      content: status === 'banned' ? '封禁后该会员将无法登录前台。' : '恢复后该会员可正常登录与使用。',
      okButtonProps: status === 'banned' ? { type: 'danger' } : undefined,
      onOk: async () => {
        await batchStatusMutation.mutateAsync({ body: { ids: [record.id], status } });
        Toast.success(`已${action}`);
      },
    });
  };

  const openAdjustGrowth = (record: Member) => { setGrowthMember(record); setGrowthVisible(true); };
  const handleAdjustGrowth = async () => {
    let values;
    try { values = await growthFormApi.current!.validate(); } catch { abortSubmit('validation'); }
    if (!growthMember) return;
    await adjustGrowthMutation.mutateAsync({ params: { id: growthMember.id }, body: values as AdjustMemberGrowthInput });
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
    await setTagsMutation.mutateAsync({ params: { id: tagsMember.id }, body: { tagIds: tagsDraft } });
    Toast.success('标签已更新');
    setTagsMember(null);
  };
  const handleBatchTags = async () => {
    if (batchTagIds.length === 0) return;
    await batchTagsMutation.mutateAsync({ body: { ids: selectedRowKeys, tagIds: batchTagIds } });
    Toast.success('已批量打标签');
    setBatchTagsVisible(false);
    setBatchTagIds([]);
    setSelectedRowKeys([]);
  };

  const openResetPwd = (record: Member) => { setPwdMember(record); setPwdVisible(true); };
  const handleResetPwd = async () => {
    let values;
    try { values = await pwdFormApi.current!.validate(); } catch { abortSubmit('validation'); }
    if (!pwdMember) return;
    await resetPasswordMutation.mutateAsync({ params: { id: pwdMember.id }, body: values as { newPassword: string } });
    Toast.success('密码已重置');
    setPwdVisible(false);
    setPwdMember(null);
  };

  // ── 批量操作 ──────────────────────────────────────────────────────────────
  const handleBatchStatus = async () => {
    const status = enumValueOf(MEMBER_STATUSES, batchStatus);
    if (!status) return;
    await batchStatusMutation.mutateAsync({ body: { ids: selectedRowKeys, status } });
    Toast.success('已更新');
    setBatchStatusVisible(false);
    setBatchStatus('');
    setSelectedRowKeys([]);
  };

  const handleBatchLevel = async () => {
    await batchLevelMutation.mutateAsync({ body: { ids: selectedRowKeys, levelId: batchLevelId ?? null } });
    Toast.success('已更新');
    setBatchLevelVisible(false);
    setBatchLevelId(undefined);
    setSelectedRowKeys([]);
  };

  const columns: ColumnProps<Member>[] = [
    {
      title: '昵称', dataIndex: 'nickname', minWidth: 180,
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
    { title: '用户名', dataIndex: 'username', width: 150, render: (v: string | null) => (v ? <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 130 }}>{v}</Typography.Text> : EMPTY_PLACEHOLDER) },
    { title: '手机号', dataIndex: 'phone', width: 130, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    { title: '邮箱', dataIndex: 'email', width: 180, render: renderEllipsis },
    { title: '等级', dataIndex: 'levelName', width: 100, render: (v: string | null) => (v ? <Tag color="amber">{v}</Tag> : EMPTY_PLACEHOLDER) },
    {
      title: '标签', dataIndex: 'tags', width: 160,
      render: (v?: Member['tags']) => (v && v.length > 0
        ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{v.map((t) => <Tag key={t.id} size="small" color={(t.color || TAG_FALLBACK_COLOR) as 'blue'}>{t.name}</Tag>)}</div>
        : EMPTY_PLACEHOLDER),
    },
    { title: '积分', dataIndex: 'pointBalance', width: 90, align: 'right', render: (v?: number) => v ?? 0 },
    { title: '余额(元)', dataIndex: 'walletBalance', width: 100, align: 'right', render: (v?: number) => ((v ?? 0) / 100).toFixed(2) },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: string) => <Tag color={STATUS_COLORS[v]}>{MEMBER_STATUS_LABELS[v as keyof typeof MEMBER_STATUS_LABELS]}</Tag>,
    },
    createOperationColumn<Member>({
      width: 180,
      desktopInlineKeys: ['detail', 'edit'],
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => setDetailMemberId(record.id) },
        { key: 'edit', label: '编辑', hidden: !hasPermission('member:member:update'), onClick: () => memberModal.openEdit(record) },
        { key: 'set-tags', label: '设置标签', hidden: !hasPermission('member:member:update'), onClick: () => openSetTags(record) },
        { key: 'quick-status', label: record.status === 'banned' ? '恢复正常' : '封禁', danger: record.status !== 'banned', hidden: !hasPermission('member:member:update'), onClick: () => handleQuickStatus(record, record.status === 'banned' ? 'active' : 'banned') },
        { key: 'adjust-growth', label: '调整成长值', hidden: !hasPermission('member:member:update'), onClick: () => openAdjustGrowth(record) },
        { key: 'reset-password', label: '重置密码', hidden: !hasPermission('member:member:update'), onClick: () => openResetPwd(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !hasPermission('member:member:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="昵称/手机号/用户名/邮箱" value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} width={240} />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={statusOptions}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderLevelFilter = () => (
    <FilterSelect
      placeholder="全部等级"
      items={levels.map((l) => ({ value: l.id, label: l.name }))}
      value={draftParams.levelId}
      onChange={(v) => setDraftParams((p) => ({ ...p, levelId: v as number | undefined }))}
      width={140}
    />
  );

  const renderTagFilter = () => (
    <FilterSelect
      placeholder="全部标签"
      items={memberTags.map((t: MemberTag) => ({ value: t.id, label: t.name }))}
      value={draftParams.tagId}
      onChange={(v) => setDraftParams((p) => ({ ...p, tagId: v as number | undefined }))}
      width={140}
    />
  );

  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const renderCreateButton = () => hasPermission('member:member:create') ? (
    <CreateButton onClick={memberModal.openCreate} />
  ) : null;
  const renderTagsManageButton = () => hasPermission('member:member:update') ? (
    <Button type="tertiary" icon={<Tags size={14} />} onClick={() => setTagsManageVisible(true)}>标签管理</Button>
  ) : null;

  const renderExportButtons = () => hasPermission('member:member:list') ? (
    <ExportButton entity="member.members" query={buildExportQuery()} />
  ) : null;

  const renderImportButton = () => hasPermission('member:member:create') ? (
    <ImportButton
      entity="member.members"
      title="会员"
      onFinished={() => void queryClient.invalidateQueries({ queryKey: memberAdminKeys.memberLists })}
    />
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
            {renderImportButton()}
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
      <AppModal {...memberModal.modalProps} width={660}>
        <Form key={memberModal.formKey} {...memberModal.formProps}>
          <Row gutter={16}>
            <Col span={12}><Form.Input field="nickname" label="昵称" placeholder="请输入昵称" rules={[{ required: true, message: '请输入昵称' }]} /></Col>
            <Col span={12}><Form.Input field="username" label="用户名" placeholder="用户名/手机号/邮箱至少填一个" disabled={!!editing} /></Col>
            <Col span={12}><Form.Input field="phone" label="手机号" placeholder="用户名/手机号/邮箱至少填一个" /></Col>
            <Col span={12}><Form.Input field="email" label="邮箱" placeholder="用户名/手机号/邮箱至少填一个" /></Col>
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
                optionList={genderItems.map((i) => ({ value: i.value, label: i.label }))} />
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
