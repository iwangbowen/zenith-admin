import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Col, Form, Row, Spin } from '@douyinfe/semi-ui';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { ChevronsUpDown, ChevronsDownUp } from 'lucide-react';
import { DEPARTMENT_CATEGORIES, userContract, type Department } from '@zenith/shared/identity';
import { enumValueOf } from '@zenith/shared/core';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import { api } from '@/lib/contract-query';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { useTreeExpansion } from '@/hooks/useTreeExpansion';
import { useEditModal } from '@/hooks/useEditModal';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import {
  departmentKeys,
  useDeleteDepartment,
  useDepartmentDetail,
  type DepartmentFormValues,
  useDepartmentTreeSearch,
  useFlatDepartments,
  useSaveDepartment,
} from '@/hooks/queries/departments';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { deleteAction, ListSearchToolbar, useStatusToggle } from '@/components/list-page';
import { memberPreviewColumn } from '@/components/members/MemberAssignmentSheet';

interface SearchParams {
  keyword: string;
  status?: string;
}

const defaultSearchParams: SearchParams = {
  keyword: '',
  status: undefined,
};

function collectDescendantIds(items: Department[], departmentId: number): Set<number> {
  const descendants = new Set<number>();
  const queue = [departmentId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (currentId === undefined) {
      continue;
    }

    for (const item of items) {
      if (item.parentId === currentId) {
        descendants.add(item.id);
        queue.push(item.id);
      }
    }
  }

  return descendants;
}

function buildDepartmentTreeData(items: Department[], excludedIds: Set<number>): TreeNodeData[] {
  const nodeMap = new Map<number, TreeNodeData>();
  const roots: TreeNodeData[] = [];

  items.forEach((item) => {
    if (excludedIds.has(item.id)) {
      return;
    }

    nodeMap.set(item.id, {
      label: item.name,
      value: item.id,
      key: String(item.id),
    });
  });

  items.forEach((item) => {
    if (excludedIds.has(item.id)) {
      return;
    }

    const node = nodeMap.get(item.id);
    if (!node) {
      return;
    }

    if (item.parentId === 0) {
      roots.push(node);
      return;
    }

    const parentNode = nodeMap.get(item.parentId);
    if (!parentNode) {
      roots.push(node);
      return;
    }

    parentNode.children = parentNode.children ?? [];
    parentNode.children.push(node);
  });

  return roots;
}

export default function DepartmentsPage() {
  const { hasPermission } = usePermission();
  const {
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: departmentKeys.tree });
  const { items: statusItems } = useDictItems('common_status');
  const { items: categoryItems } = useDictItems('department_category');

  const treeQuery = useDepartmentTreeSearch({
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
  });
  const data = useMemo(() => treeQuery.data ?? [], [treeQuery.data]);
  const flatDepartmentsQuery = useFlatDepartments();
  const allDepartments = useMemo(() => flatDepartmentsQuery.data ?? [], [flatDepartmentsQuery.data]);
  const saveMutation = useSaveDepartment();
  const modal = useEditModal<Department, DepartmentFormValues>({
    entityName: '部门',
    save: saveMutation,
    useDetail: useDepartmentDetail,
    defaults: { parentId: 0, category: 'department', sort: 0, status: 'enabled' },
    toValues: (department) => ({
      parentId: department.parentId,
      name: department.name,
      code: department.code,
      category: enumValueOf(DEPARTMENT_CATEGORIES, department.category) ?? 'department',
      leaderId: department.leaderId ?? undefined,
      phone: department.phone,
      email: department.email,
      sort: department.sort,
      status: department.status,
    }),
  });
  const toggleStatusMutation = useSaveDepartment();
  const deleteMutation = useDeleteDepartment();
  const [leaderKeyword, setLeaderKeyword] = useState('');
  const leaderOptionsQuery = useQuery({
    queryKey: ['users', 'options', leaderKeyword],
    queryFn: () => api(userContract.list, { query: { pageSize: 50, keyword: leaderKeyword || undefined } }),
    enabled: modal.visible,
    staleTime: 30_000,
  });
  const leaderOptions = (leaderOptionsQuery.data?.list ?? []).map((u) => ({
    value: u.id,
    label: u.departmentName ? `${u.nickname}-${u.departmentName}` : u.nickname,
  }));

  const { expandedRowKeys, isAllExpanded, toggleExpandAll, onExpandedRowsChange } = useTreeExpansion(data);

  const parentTreeData = useMemo(() => {
    const excludedIds = modal.editing
      ? new Set([modal.editing.id, ...collectDescendantIds(allDepartments, modal.editing.id)])
      : new Set<number>();

    return [
      {
        label: '顶级部门',
        value: 0,
        key: '0',
        children: buildDepartmentTreeData(allDepartments, excludedIds),
      },
    ];
  }, [allDepartments, modal.editing]);

  const openCreate = () => {
    setLeaderKeyword('');
    modal.openCreate();
  };

  const openEdit = (record: Department) => {
    modal.openEdit(record);
  };

  const status = useStatusToggle<Department>({
    toggle: (dept, enabled) => toggleStatusMutation.mutateAsync({ id: dept.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (dept) => ({ danger: true, title: `确认停用部门「${dept.name}」？`, content: '停用后该部门将不可选择。', okText: '确认停用' }),
    disabled: !hasPermission('system:department:update'),
  });


  const columns: ColumnProps<Department>[] = [
    { title: '部门名称', dataIndex: 'name', minWidth: 220 },
    { title: '部门编码', dataIndex: 'code', width: 180, render: renderEllipsis },
    { title: '类别', dataIndex: 'category', width: 90, render: (value: string) => <DictTag dictCode="department_category" value={value} /> },
    { title: '负责人', dataIndex: 'leaderName', width: 120, render: (value) => value || '—' },
    { title: '联系电话', dataIndex: 'phone', width: 140, render: (value) => value || '—' },
    { title: '邮箱', dataIndex: 'email', width: 200, render: renderEllipsis },
    { title: '排序', dataIndex: 'sort', width: 90 },
    memberPreviewColumn<Department>({
      dataIndex: 'userPreview',
      width: 150,
      getPreview: (record) => record.userPreview,
      getCount: (record) => record.userCount,
      getScope: (record) => ({ type: 'department', id: record.id, name: record.name }),
    }),
    createdAtColumn,
    status.column(),
    createOperationColumn<Department>({
      width: 150,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:department:update'),
          onClick: () => { void openEdit(record); },
        },
        deleteAction({
          hidden: !hasPermission('system:department:delete'),
          title: '确定要删除该部门吗？',
          run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
        }),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="搜索部门名称/编码" value={draftParams.keyword} onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))} onSearch={handleSearch} width={240} />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={statusItems}
      value={draftParams.status}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, status: value }))}
    />
  );

  const renderExpandButton = (flat = false) => (
    <Button
      type="primary"
      theme={flat ? 'borderless' : undefined}
      icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
      onClick={toggleExpandAll}
    >
      {isAllExpanded ? '全部折叠' : '全部展开'}
    </Button>
  );
  const buildExportQuery = () => ({
    ...(submittedParams.keyword ? { keyword: submittedParams.keyword } : {}),
    ...(submittedParams.status ? { status: submittedParams.status } : {}),
  });
  const renderExportButtons = () => <ExportButton entity="system.departments" query={buildExportQuery()} />;
  const renderMobileExportActions = () => <ExportButton entity="system.departments" query={buildExportQuery()} variant="flat" />;
  const renderCreateButton = () => hasPermission('system:department:create') ? (
    <CreateButton onClick={openCreate} />
  ) : null;

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={renderKeywordSearch()}
        filters={renderStatusFilter()}
        onSearch={handleSearch}
        onReset={handleReset}
        create={renderCreateButton()}
        actions={(
          <>
            {renderExpandButton()}
            {renderExportButtons()}
          </>
        )}
        mobileActions={(
          <>
            {renderExpandButton(true)}
            {renderMobileExportActions()}
          </>
        )}
        filterTitle="部门筛选"
        actionTitle="部门操作"
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={treeQuery.isFetching}
        onRefresh={() => void treeQuery.refetch()}
        refreshLoading={treeQuery.isFetching}
        rowKey="id"
        pagination={false}
        empty="暂无数据"
        expandedRowKeys={expandedRowKeys}
        onExpandedRowsChange={onExpandedRowsChange}
      />

      <AppModal
        {...modal.modalProps}
        width={660}

      >
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={modal.formKey} {...modal.formProps}
        >
          <Form.TreeSelect
            field="parentId"
            label="上级部门"
            style={{ width: '100%' }}
            treeData={parentTreeData}
            placeholder="请选择上级部门"
            filterTreeNode
          />
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="部门名称" placeholder="请输入部门名称" rules={[{ required: true, message: '请输入部门名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="code" label="部门编码" placeholder="请输入部门编码" rules={[{ required: true, message: '请输入部门编码' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select
                field="category"
                label="类别"
                optionList={categoryItems.map((item) => ({ value: item.value, label: item.label }))}
                style={{ width: '100%' }}
                placeholder="请选择类别"
                rules={[{ required: true, message: '请选择类别' }]}
              />
            </Col>
            <Col span={12}>
              <Form.Select
                field="leaderId"
                label="负责人"
                placeholder="请选择负责人"
                showClear
                filter
                remote
                loading={leaderOptionsQuery.isFetching}
                optionList={leaderOptions}
                onSearch={setLeaderKeyword}
                style={{ width: '100%' }}
              />
            </Col>
            <Col span={12}>
              <Form.Input field="phone" label="联系电话" placeholder="请输入联系电话" />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="email" label="邮箱" placeholder="请输入邮箱" />
            </Col>
            <Col span={12}>
              <Form.InputNumber field="sort" label="排序" placeholder="请输入排序" min={0} style={{ width: '100%' }} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select
                field="status"
                label="状态"
                optionList={statusItems.map((item) => ({ value: item.value, label: item.label }))}
                style={{ width: '100%' }}
                placeholder="请选择状态"
              />
            </Col>
          </Row>
        </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
