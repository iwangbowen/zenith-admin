import { useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { Col, Form, Row, Select, SideSheet, Spin, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { CreateWikiSpaceInput, WikiSpace, WikiSpaceMemberRole } from '@zenith/shared/wiki';
import { WIKI_SPACE_MEMBER_ROLE_LABELS, WIKI_SPACE_MEMBER_ROLE_OPTIONS, WIKI_SPACE_VISIBILITIES, WIKI_SPACE_VISIBILITY_LABELS, WIKI_SPACE_VISIBILITY_OPTIONS } from '@zenith/shared/wiki';
import { USER_STATUSES, enumValueOf } from '@zenith/shared/core';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { CreateButton } from '@/components/toolbar-controls';
import AppModal from '@/components/AppModal';
import { UserTransferSelect } from '@/components/UserTransferSelect';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { useAllUsers } from '@/hooks/queries/users';
import {
  useDeleteWikiSpaces, useSaveWikiSpace, useSaveWikiSpaceMembers, useWikiSpaceDetail,
  useWikiSpaceList, useWikiSpaceMembers, wikiSpaceKeys,
} from '@/hooks/queries/wiki-spaces';
import ModalFooter from '@/components/ModalFooter';

const { Text } = Typography;

interface SearchParams {
  keyword: string;
  visibility?: string;
  status?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', visibility: undefined, status: '' };

export default function WikiSpacesPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();

  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: wikiSpaceKeys.lists });

  const listQuery = useWikiSpaceList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    visibility: enumValueOf(WIKI_SPACE_VISIBILITIES, submittedParams.visibility),
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  });

  const modal = useEditModal<WikiSpace, Partial<CreateWikiSpaceInput>>({
    entityName: '知识空间',
    save: useSaveWikiSpace(),
    useDetail: useWikiSpaceDetail,
    defaults: { visibility: 'public', status: 'enabled', sort: 0, aiSyncEnabled: false },
    // 记录里的 null 在表单中归一为未填
    toValues: (r) => ({
      name: r.name,
      description: r.description ?? undefined,
      icon: r.icon ?? undefined,
      visibility: r.visibility,
      status: r.status,
      sort: r.sort,
      aiSyncEnabled: r.aiSyncEnabled,
    }),
  });

  const toggleStatusMutation = useSaveWikiSpace();
  const deleteMutation = useDeleteWikiSpaces();
  const status = useStatusToggle<WikiSpace>({
    toggle: (record, enabled) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({
      title: '确认停用',
      content: `停用后「${record.name}」将不在文档中心展示，确认停用？`,
    }),
    disabled: !hasPermission('wiki:space:edit'),
  });
  const { items: statusItems } = useDictItems('common_status');

  // ─── 成员授权抽屉 ──────────────────────────────────────────────────────────
  const [memberSpace, setMemberSpace] = useState<WikiSpace | null>(null);
  const [memberDraft, setMemberDraft] = useState<Array<{ userId: number; role: WikiSpaceMemberRole }>>([]);
  const membersQuery = useWikiSpaceMembers(memberSpace?.id);
  const saveMembersMutation = useSaveWikiSpaceMembers();
  const usersQuery = useAllUsers({ enabled: !!memberSpace });
  const allUsers = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const userMap = useMemo(() => new Map(allUsers.map((u) => [u.id, u])), [allUsers]);

  // 抽屉打开且成员数据到达时播种交互态
  useEffect(() => {
    if (!memberSpace || !membersQuery.data) return;
    setMemberDraft(membersQuery.data.map((m) => ({ userId: m.userId, role: m.role })));
  }, [memberSpace, membersQuery.data]);

  function handleMemberIdsChange(ids: number[]) {
    setMemberDraft((prev) => {
      const prevMap = new Map(prev.map((m) => [m.userId, m.role]));
      return ids.map((userId) => ({ userId, role: prevMap.get(userId) ?? 'viewer' as WikiSpaceMemberRole }));
    });
  }

  function handleSaveMembers() {
    if (!memberSpace) return;
    saveMembersMutation.mutate(
      { params: { id: memberSpace.id }, body: { members: memberDraft } },
      { onSuccess: () => { Toast.success('成员保存成功'); setMemberSpace(null); } },
    );
  }

  const columns: ColumnProps<WikiSpace>[] = [
    {
      title: '空间名称', dataIndex: 'name', width: 180,
      render: (v: string, record: WikiSpace) => (
        <Text
          link
          ellipsis={{ showTooltip: true }}
          onClick={() => navigate(`/wiki/docs?spaceId=${record.id}`)}
        >
          {v}
        </Text>
      ),
    },
    { title: '描述', dataIndex: 'description', minWidth: 220, render: renderEllipsis },
    {
      title: '可见性', dataIndex: 'visibility', width: 100,
      render: (v: WikiSpace['visibility']) => WIKI_SPACE_VISIBILITY_LABELS[v],
    },
    { title: '成员数', dataIndex: 'memberCount', width: 90, align: 'right' },
    { title: '文档数', dataIndex: 'docCount', width: 90, align: 'right' },
    {
      title: 'AI 同步', dataIndex: 'aiSyncEnabled', width: 90,
      render: (v: boolean) => (v ? '开启' : '关闭'),
    },
    createdAtColumn,
    status.column(),
    createOperationColumn<WikiSpace>({
      width: 180,
      desktopInlineKeys: ['members', 'edit'],
      actions: (record) => [
        ...(hasPermission('wiki:space:grant') ? [{
          key: 'members', label: '成员', onClick: () => setMemberSpace(record),
        }] : []),
        ...(hasPermission('wiki:space:edit') ? [{
          key: 'edit', label: '编辑', onClick: () => modal.openEdit(record),
        }] : []),
        deleteAction({
          hidden: !hasPermission('wiki:space:delete'),
          title: `确定要删除空间「${record.name}」吗？`,
          content: '仅空的空间可删除，删除后不可恢复',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput
      placeholder="搜索空间名称..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      onSearch={handleSearch}
    />
  );

  const renderVisibilityFilter = () => (
    <FilterSelect
      placeholder="全部可见性"
      items={WIKI_SPACE_VISIBILITY_OPTIONS}
      value={draftParams.visibility}
      onChange={(v) => setDraftParams((p) => ({ ...p, visibility: v }))}
      width={140}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={statusItems}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderCreateButton = () => hasPermission('wiki:space:create')
    ? <CreateButton onClick={modal.openCreate} /> : null;

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={renderKeywordSearch()}
        filters={<>
          {renderVisibilityFilter()}
          {renderStatusFilter()}
        </>}
        onSearch={handleSearch}
        onReset={handleReset}
        create={renderCreateButton()}
        filterTitle="筛选条件"
      />

      <ConfigurableTable<WikiSpace>
        columns={columns}
        empty="暂无数据"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal {...modal.modalProps} width={660}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="name" label="空间名称" placeholder="请输入空间名称"
                  rules={[{ required: true, message: '空间名称不能为空' }]} />
              </Col>
              <Col span={12}>
                <Form.Select field="visibility" label="可见性" style={{ width: '100%' }}
                  optionList={WIKI_SPACE_VISIBILITY_OPTIONS}
                  rules={[{ required: true, message: '请选择可见性' }]} />
              </Col>
            </Row>
            <Form.Input field="description" label="描述" placeholder="空间用途简介（选填）" />
            <Row gutter={16}>
              <Col span={12}>
                <Form.InputNumber field="sort" label="排序" style={{ width: '100%' }} />
              </Col>
              <Col span={12}>
                <Form.Select field="status" label="状态" style={{ width: '100%' }}
                  optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
                  rules={[{ required: true, message: '请选择状态' }]} />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Switch field="aiSyncEnabled" label="同步 AI 知识库" />
              </Col>
            </Row>
          </Form>
        </Spin>
      </AppModal>

      {/* 成员授权抽屉 */}
      <SideSheet
        title={`空间成员 · ${memberSpace?.name ?? ''}`}
        visible={!!memberSpace}
        onCancel={() => setMemberSpace(null)}
        closeOnEsc
        width={720}
        footer={<ModalFooter onCancel={() => setMemberSpace(null)} onOk={handleSaveMembers} okText="保存" loading={saveMembersMutation.isPending} />}
      >
        <Spin spinning={membersQuery.isFetching || usersQuery.isPending}>
          <UserTransferSelect
            dataSource={allUsers}
            value={memberDraft.map((m) => m.userId)}
            onChange={handleMemberIdsChange}
          />
          {memberDraft.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <Text strong>成员角色（{memberDraft.length}）</Text>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {memberDraft.map((m) => (
                  <div key={m.userId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <Text ellipsis={{ showTooltip: true }} style={{ flex: 1, minWidth: 0 }}>
                      {userMap.get(m.userId)?.nickname ?? userMap.get(m.userId)?.username ?? `用户 #${m.userId}`}
                    </Text>
                    <Select
                      style={{ width: 130 }}
                      value={m.role}
                      onChange={(v) => setMemberDraft((prev) => prev.map((x) => (x.userId === m.userId ? { ...x, role: v as WikiSpaceMemberRole } : x)))}
                      optionList={WIKI_SPACE_MEMBER_ROLE_OPTIONS}
                    />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8 }}>
                <Text type="tertiary" size="small">
                  角色说明：{WIKI_SPACE_MEMBER_ROLE_OPTIONS.map((o) => `${o.label}${o.value === 'owner' ? '(管理+删除空间)' : o.value === 'admin' ? '(管理文档与成员)' : o.value === 'editor' ? '(创建编辑文档)' : '(只读)'}`).join(' / ')}
                  ；空间至少保留一名{WIKI_SPACE_MEMBER_ROLE_LABELS.owner}
                </Text>
              </div>
            </div>
          ) : null}
        </Spin>
      </SideSheet>
    </div>
  );
}
