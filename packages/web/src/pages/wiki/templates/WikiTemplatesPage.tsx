import { useMemo } from 'react';
import { Col, Form, Row, Spin } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { CreateWikiTemplateInput, WikiTemplate } from '@zenith/shared/wiki';
import { USER_STATUSES, enumValueOf } from '@zenith/shared/core';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { CreateButton } from '@/components/toolbar-controls';
import AppModal from '@/components/AppModal';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { compactParams } from '@/lib/query';
import { useListSearch } from '@/hooks/useListSearch';
import {
  useDeleteWikiTemplates, useSaveWikiTemplate, useWikiTemplateDetail, useWikiTemplateList, wikiTemplateKeys,
} from '@/hooks/queries/wiki-templates';

interface SearchParams {
  keyword: string;
  status?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: undefined };

export default function WikiTemplatesPage() {
  const { hasPermission } = usePermission();

  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: wikiTemplateKeys.lists });

  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  }), [submittedParams]);

  const listQuery = useWikiTemplateList({ page, pageSize, ...filterQuery });

  const modal = useEditModal<WikiTemplate, Partial<CreateWikiTemplateInput>>({
    entityName: '文档模板',
    save: useSaveWikiTemplate(),
    useDetail: useWikiTemplateDetail,
    defaults: { status: 'enabled', sort: 0, content: '' },
    // 记录里的 null 在表单中归一为未填
    toValues: (r) => ({
      name: r.name,
      description: r.description ?? undefined,
      content: r.content,
      status: r.status,
      sort: r.sort,
    }),
  });

  const toggleStatusMutation = useSaveWikiTemplate();
  const deleteMutation = useDeleteWikiTemplates();
  const status = useStatusToggle<WikiTemplate>({
    toggle: (record, enabled) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({
      title: '确认停用',
      content: `停用后「${record.name}」将不再出现在编辑器模板选择中，确认停用？`,
    }),
    disabled: !hasPermission('wiki:template:edit'),
  });
  const { items: statusItems, options: statusOptions } = useDictItems('common_status');

  const columns: ColumnProps<WikiTemplate>[] = [
    { title: '模板名称', dataIndex: 'name', width: 200, render: renderEllipsis },
    { title: '描述', dataIndex: 'description', minWidth: 260, render: renderEllipsis },
    { title: '排序', dataIndex: 'sort', width: 80 },
    createdAtColumn,
    status.column(),
    createOperationColumn<WikiTemplate>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        ...(hasPermission('wiki:template:edit') ? [{
          key: 'edit', label: '编辑', onClick: () => modal.openEdit(record),
        }] : []),
        deleteAction({
          hidden: !hasPermission('wiki:template:delete'),
          title: `确定要删除模板「${record.name}」吗？`,
          content: '删除后不可恢复，不影响已用模板创建的文档',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <KeywordInput
            placeholder="搜索模板名称..."
            {...bindKeyword('keyword')}
          />
        )}
        filters={(
          <StatusSelect
            items={statusItems}
            {...bind('status')}
          />
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('wiki:template:create')
            ? <CreateButton onClick={modal.openCreate} /> : null
        )}
        filterTitle="筛选条件"
      />

      <ConfigurableTable<WikiTemplate>
        columns={columns}
        empty="暂无模板"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal {...modal.modalProps} width={660}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="name" label="模板名称" placeholder="请输入模板名称"
                  rules={[{ required: true, message: '模板名称不能为空' }]} />
              </Col>
              <Col span={12}>
                <Form.InputNumber field="sort" label="排序" style={{ width: '100%' }} />
              </Col>
            </Row>
            <Form.Input field="description" label="描述" placeholder="模板用途简介（选填）" />
            <Form.TextArea field="content" label="模板内容" placeholder="Markdown 模板内容"
              rows={12} style={{ fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace", fontSize: 13 }} />
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select field="status" label="状态" style={{ width: '100%' }}
                  optionList={statusOptions}
                  rules={[{ required: true, message: '请选择状态' }]} />
              </Col>
            </Row>
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
