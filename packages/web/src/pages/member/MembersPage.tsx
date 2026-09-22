import { MemberVipRenewalDetail } from './MemberFulfillmentDetail';
import { FormPasswordInput } from '@/components/PasswordInput';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Select, Form, Toast, Tag, Spin, Row, Col, Dropdown, Modal } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { KeyRound, ChevronDown, Tags } from 'lucide-react';
import type { Member, MemberTag } from '@zenith/shared/member';
import { MEMBER_STATUSES, MEMBER_STATUS_LABELS, type AdjustMemberGrowthInput } from '@zenith/shared/member';
import { enumValueOf } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { UserAvatar } from '@/components/UserAvatar';
import ExportButton from '@/components/ExportButton';
import ImportButton from '@/components/ImportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, listTableProps, useRowSelection, useCrudOperationColumn } from '@/components/list-page';
import { createdAtColumn, EMPTY_PLACEHOLDER, overflowTagColumn, renderEllipsis } from '@/utils/table-columns';
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
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { useEditModal } from '@/hooks/useEditModal';
import { useSensitiveFormFields } from '@/hooks/useSensitiveFormFields';
import { SensitiveFormInput, SensitiveText } from '@/components/sensitive';
import { abortSubmit } from '@/lib/abort-submit';
import { MEMBER_STATUS_COLORS } from './member-tag-colors';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import { EditFormModal } from '@/components/EditFormModal';

const statusOptions = (['active', 'inactive', 'banned'] as const).map((v) => ({ value: v, label: MEMBER_STATUS_LABELS[v] }));
const TAG_FALLBACK_COLOR = 'blue';

interface SearchParams { keyword: string; status?: string; levelId?: number; tagId?: number }
const defaultSearch: SearchParams = { keyword: '', status: undefined, levelId: undefined, tagId: undefined };

export default function MembersPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const { options: genderOptions } = useDictItems('user_gender');
  // useEditModal 例外：重置密码对话框（针对既有会员的动作表单，非新增 / 编辑）
  const pwdFormApi = useRef<FormApi | null>(null);
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset, applySearch,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: memberAdminKeys.memberLists });
  // 等级列表"会员数"等入口的深链筛选（?levelId=，消费后即从 URL 移除）
  useListDeepLink(['levelId', 'keyword', 'memberId', 'renewalId'], (p) => {
    if (p.levelId !== undefined || p.keyword !== undefined) applySearch({ ...defaultSearch, levelId: Number(p.levelId) || undefined, keyword: p.keyword ?? '' });
    const renewalId = Number(p.renewalId);
    if (p.renewalId && /^[1-9]\d*$/.test(p.renewalId) && Number.isSafeInteger(renewalId) && renewalId <= 2_147_483_647) { setDetailMemberId(null); setRenewalId(renewalId); }
    if (p.memberId && /^[1-9]\d*$/.test(p.memberId)) { setRenewalId(null); setDetailMemberId(Number(p.memberId)); }
  });
  const [pwdVisible, setPwdVisible] = useState(false);
  const [pwdMember, setPwdMember] = useState<Member | null>(null);
  const [growthVisible, setGrowthVisible] = useState(false);
  const [growthMember, setGrowthMember] = useState<Member | null>(null);
  // useEditModal 例外：调整成长值对话框（针对既有会员的动作表单，非新增 / 编辑）
  const growthFormApi = useRef<FormApi | null>(null);
  // member tags
  const [tagsMember, setTagsMember] = useState<Member | null>(null);
  const [tagsDraft, setTagsDraft] = useState<number[]>([]);
  const [tagsManageVisible, setTagsManageVisible] = useState(false);
  const [batchTagsVisible, setBatchTagsVisible] = useState(false);
  const [batchTagIds, setBatchTagIds] = useState<number[]>([]);
  // batch operations
  const { selectedRowKeys, clear: clearSelection, rowSelection } = useRowSelection();
  const [batchStatusVisible, setBatchStatusVisible] = useState(false);
  const [batchLevelVisible, setBatchLevelVisible] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string>('');
  const [batchLevelId, setBatchLevelId] = useState<number | undefined>(undefined);
  // detail drawer
  const [renewalId, setRenewalId] = useState<number | null>(null);
  const [detailMemberId, setDetailMemberId] = useState<number | null>(null);
  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useFilterQuery({
    keyword: submittedParams.keyword,
    status: enumValueOf(MEMBER_STATUSES, submittedParams.status),
    levelId: submittedParams.levelId,
    tagId: submittedParams.tagId,
  });
  const listQuery = useMemberList({ page, pageSize, ...filterQuery });
  const levelsQuery = useMemberLevels();
  const tagsQuery = useMemberTags();
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

  // 敏感字段（手机号 / 邮箱）对非豁免用户是掩码：编辑时锁定，提交前剔除未修改的锁定字段
  const sensitiveFieldsRef = useRef<ReturnType<typeof useSensitiveFormFields<Member>> | null>(null);
  const memberModal = useEditModal<Member, MemberFormValues>({
    entityName: '会员',
    save: saveMutation,
    defaults: { status: 'active' as const },
    toValues: (record) => ({ nickname: record.nickname, phone: record.phone, email: record.email, gender: record.gender, levelId: record.levelId, status: record.status, remark: record.remark }),
    beforeSave: (rawValues, ctx) => {
      const control = sensitiveFieldsRef.current;
      const values = (control ? control.strip(rawValues as unknown as Record<string, unknown>) : rawValues) as MemberFormValues;
      // 与前台注册契约一致：无任何登录凭证的会员无法登录也无法找回密码（锁定字段沿用原值，视为已填）
      const username = ctx.editing?.username ?? values.username;
      const phone = 'phone' in values ? values.phone : ctx.editing?.phone;
      const email = 'email' in values ? values.email : ctx.editing?.email;
      if (!username?.toString().trim() && !phone?.toString().trim() && !email?.toString().trim()) {
        Toast.warning('用户名、手机号、邮箱至少填写一个，否则该会员将无法登录');
        abortSubmit('validation');
      }
      return values;
    },
  });
  const editing = memberModal.editing;
  const sensitiveFields = useSensitiveFormFields<Member>({ entity: 'Member', fields: ['phone', 'email'], record: editing });
  sensitiveFieldsRef.current = sensitiveFields;

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
    clearSelection();
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
    clearSelection();
  };

  const handleBatchLevel = async () => {
    await batchLevelMutation.mutateAsync({ body: { ids: selectedRowKeys, levelId: batchLevelId ?? null } });
    Toast.success('已更新');
    setBatchLevelVisible(false);
    setBatchLevelId(undefined);
    clearSelection();
  };

  const operationColumn = useCrudOperationColumn<Member>({
    permission: 'member:member',
    edit: memberModal,
    remove: deleteMutation,
    title: (record) => `确认删除会员「${record.nickname}」？`,
    content: '删除后该会员将无法登录、不再出现在列表中；其积分/钱包流水、券码与签到记录将保留用于审计对账。',
    extra: (record) => [
      { key: 'detail', label: '详情', onClick: () => setDetailMemberId(record.id) },
    ],
    extraBetween: (record) => [
      { key: 'set-tags', label: '设置标签', hidden: !hasPermission('member:member:update'), onClick: () => openSetTags(record) },
      { key: 'quick-status', label: record.status === 'banned' ? '恢复正常' : '封禁', danger: record.status !== 'banned', hidden: !hasPermission('member:member:update'), onClick: () => handleQuickStatus(record, record.status === 'banned' ? 'active' : 'banned') },
      { key: 'adjust-growth', label: '调整成长值', hidden: !hasPermission('member:member:update'), onClick: () => openAdjustGrowth(record) },
      { key: 'reset-password', label: '重置密码', hidden: !hasPermission('member:member:update'), onClick: () => openResetPwd(record) },
    ],
    width: 180,
    desktopInlineKeys: ['detail', 'edit'],
  });

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
    { title: '用户名', dataIndex: 'username', width: 150, render: renderEllipsis },
    { title: '手机号', dataIndex: 'phone', width: 150, render: (v: string | null, record: Member) => <SensitiveText entity="Member" id={record.id} field="phone" value={v} /> },
    { title: '邮箱', dataIndex: 'email', width: 200, render: (v: string | null, record: Member) => <SensitiveText entity="Member" id={record.id} field="email" value={v} /> },
    { title: '等级', dataIndex: 'levelName', width: 100, render: (v: string | null) => (v ? <Tag color="amber">{v}</Tag> : EMPTY_PLACEHOLDER) },
    overflowTagColumn<Member>({
      title: '标签',
      dataIndex: 'tags',
      width: 160,
      contentWidth: 128,
      getItems: (tags) => ((tags as Member['tags'] | undefined) ?? []).map((t) => ({
        key: String(t.id),
        label: t.name,
        color: (t.color || TAG_FALLBACK_COLOR) as TagColor,
      })),
      popoverWidth: 160,
    }),
    { title: '积分', dataIndex: 'pointBalance', width: 90, align: 'right', render: (v?: number) => v ?? 0 },
    { title: '余额(元)', dataIndex: 'walletBalance', width: 100, align: 'right', render: (v?: number) => ((v ?? 0) / 100).toFixed(2) },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: string) => <Tag color={MEMBER_STATUS_COLORS[v]}>{MEMBER_STATUS_LABELS[v as keyof typeof MEMBER_STATUS_LABELS]}</Tag>,
    },
    operationColumn,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="昵称/手机号/用户名/邮箱" {...bindKeyword('keyword')} width={240} />}
        filters={(
          <>
            <StatusSelect
              items={statusOptions}
              {...bind('status')}
            />
            <FilterSelect
              placeholder="全部等级"
              items={levels.map((l) => ({ value: l.id, label: l.name }))}
              {...bind('levelId')}
              width={140}
            />
            <FilterSelect
              placeholder="全部标签"
              items={memberTags.map((t: MemberTag) => ({ value: t.id, label: t.name }))}
              {...bind('tagId')}
              width={140}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={<CreateButton permission="member:member:create" onClick={memberModal.openCreate} />}
        actions={<><ExportButton entity="member.members" query={filterQuery} permission="member:member:list" />{hasPermission('member:member:create') ? (
          <ImportButton
            entity="member.members"
            title="会员"
            onFinished={() => void queryClient.invalidateQueries({ queryKey: memberAdminKeys.memberLists })}
          />
        ) : null}{hasPermission('member:member:update') ? (
          <Button type="tertiary" icon={<Tags size={14} />} onClick={() => setTagsManageVisible(true)}>标签管理</Button>
        ) : null}</>}
        mobileActions={(
          <ExportButton entity="member.members" query={filterQuery} permission="member:member:list" />
        )}
        filterTitle="会员筛选"
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
          <Button size="small" type="tertiary" onClick={() => clearSelection()}>取消选择</Button>
        </div>
      )}

      <ConfigurableTable<Member> columns={columns}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          rowSelection,
          empty: '暂无数据',
        })} />

      {/* 编辑 / 新增 Modal */}
      <EditFormModal modal={memberModal} width={660}>
        <Row gutter={16}>
          <Col span={12}><Form.Input field="nickname" label="昵称" placeholder="请输入昵称" rules={[{ required: true, message: '请输入昵称' }]} /></Col>
          <Col span={12}><Form.Input field="username" label="用户名" placeholder="用户名/手机号/邮箱至少填一个" disabled={!!editing} /></Col>
          <Col span={12}><SensitiveFormInput control={sensitiveFields} field="phone" label="手机号" placeholder="用户名/手机号/邮箱至少填一个" /></Col>
          <Col span={12}><SensitiveFormInput control={sensitiveFields} field="email" label="邮箱" placeholder="用户名/手机号/邮箱至少填一个" /></Col>
          {!editing && <Col span={12}><FormPasswordInput field="password" label="密码" placeholder="选填，留空则无密码" /></Col>}
          <Col span={12}>
            <Form.Select field="levelId" label="会员等级" placeholder="请选择" style={{ width: '100%' }} showClear
              optionList={levels.map((l) => ({ value: l.id, label: l.name }))} />
          </Col>
          <Col span={12}>
            <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusOptions} />
          </Col>
          <Col span={12}>
            <Form.Select field="gender" label="性别" placeholder="请选择" style={{ width: '100%' }} showClear
              optionList={genderOptions} />
          </Col>
        </Row>
        <Form.TextArea field="remark" label="备注" placeholder="请输入备注" maxCount={256} />
      </EditFormModal>

      {/* 重置密码 Modal */}
      <AppModal title="重置会员密码" visible={pwdVisible} width={480}
        onCancel={() => { setPwdVisible(false); setPwdMember(null); }} onOk={handleResetPwd}>
        <Spin spinning={false}>
          <Form getFormApi={(api) => { pwdFormApi.current = api; }} labelPosition="left" labelWidth={90}>
            <FormPasswordInput field="newPassword" label="新密码" prefix={<KeyRound size={14} />}
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
      <MemberVipRenewalDetail id={renewalId} onClose={() => setRenewalId(null)} />
      <MemberDetailDrawer memberId={detailMemberId} onClose={() => setDetailMemberId(null)} />
    </div>
  );
}
