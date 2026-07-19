import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Form, Input, Modal, Select, SideSheet, Space, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { RuleList, RuleListItem } from '@zenith/shared';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { formatDateTimeForApi } from '@/utils/date';
import {
  ruleKeys,
  useBatchImportRuleListItems,
  useCheckRuleList,
  useDeleteRuleList,
  useDeleteRuleListItem,
  usePurgeExpiredRuleListItems,
  useRuleListItems,
  useRuleListList,
  useSaveRuleList,
  useSaveRuleListItem,
} from '@/hooks/queries/rules';

const { Text } = Typography;

const TYPE_META: Record<string, { text: string; color: 'red' | 'green' | 'grey' }> = {
  black: { text: '黑名单', color: 'red' },
  white: { text: '白名单', color: 'green' },
  grey: { text: '灰名单', color: 'grey' },
};
const TYPE_OPTIONS = [
  { value: 'black', label: '黑名单' },
  { value: 'white', label: '白名单' },
  { value: 'grey', label: '灰名单' },
];

/** 规则中心 · 名单库：黑/白/灰名单与条目管理（支持过期时间、批量导入、命中测试） */
export default function RuleListsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const canCreate = hasPermission('rule:list:create');
  const canEdit = hasPermission('rule:list:update');
  const canDelete = hasPermission('rule:list:delete');
  const canManageItems = hasPermission('rule:list:item');
  const { page, pageSize, setPage, buildPagination } = usePagination();

  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [draftType, setDraftType] = useState<string | undefined>(undefined);
  const [submittedType, setSubmittedType] = useState<string | undefined>(undefined);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<RuleList | null>(null);
  const [itemsRow, setItemsRow] = useState<RuleList | null>(null);
  const [itemsPage, setItemsPage] = useState(1);
  const [itemKeyword, setItemKeyword] = useState('');
  const [itemForm, setItemForm] = useState<{ value: string; label: string; expiresAt?: string; remark: string }>({ value: '', label: '', remark: '' });
  const [importText, setImportText] = useState('');
  const [checkValue, setCheckValue] = useState('');
  const [checkResult, setCheckResult] = useState<{ hit: boolean; listType?: string } | null>(null);
  const formApi = useRef<FormApi | null>(null);

  const listQuery = useRuleListList({ page, pageSize, keyword: submittedKeyword || undefined, type: submittedType as 'black' | 'white' | 'grey' | undefined });
  const data = listQuery.data ?? null;
  const itemsQuery = useRuleListItems(itemsRow?.id, { page: itemsPage, pageSize: 10, keyword: itemKeyword || undefined }, !!itemsRow);
  const items = itemsQuery.data ?? null;
  const saveMutation = useSaveRuleList();
  const deleteMutation = useDeleteRuleList();
  const saveItemMutation = useSaveRuleListItem();
  const batchImportMutation = useBatchImportRuleListItems();
  const deleteItemMutation = useDeleteRuleListItem();
  const purgeMutation = usePurgeExpiredRuleListItems();
  const checkMutation = useCheckRuleList();

  const openCreate = () => { setEditing(null); setModalVisible(true); };
  const openEdit = (r: RuleList) => { setEditing(r); setModalVisible(true); };
  const openItems = (r: RuleList) => {
    setItemsRow(r);
    setItemsPage(1);
    setItemKeyword('');
    setItemForm({ value: '', label: '', remark: '' });
    setImportText('');
    setCheckValue('');
    setCheckResult(null);
  };

  const handleSubmit = async () => {
    const v = await formApi.current?.validate();
    if (!v) return;
    const payload = editing
      ? { name: v.name, type: v.type, description: v.description ?? null }
      : { key: v.key, name: v.name, type: v.type, description: v.description ?? null };
    await saveMutation.mutateAsync({ id: editing?.id, values: payload });
    Toast.success(editing ? '更新成功' : '创建成功');
    setModalVisible(false);
  };

  const handleToggle = (r: RuleList) => { Modal.confirm({
    title: r.status === 'enabled' ? `停用「${r.name}」？` : `启用「${r.name}」？`,
    content: r.status === 'enabled' ? '停用后运行时命中判定一律返回未命中' : '启用后恢复命中判定',
    okButtonProps: r.status === 'enabled' ? { type: 'danger' } : undefined,
    onOk: async () => { await saveMutation.mutateAsync({ id: r.id, values: { status: r.status === 'enabled' ? 'disabled' : 'enabled' } }); Toast.success('操作成功'); },
  }); };
  const handleDelete = (r: RuleList) => { Modal.confirm({
    title: '确定删除？', content: '将级联删除全部条目，删除后不可恢复', okButtonProps: { type: 'danger' },
    onOk: async () => { await deleteMutation.mutateAsync(r.id); Toast.success('删除成功'); },
  }); };

  const addItem = async () => {
    if (!itemsRow) return;
    if (!itemForm.value.trim()) { Toast.warning('请输入名单值'); return; }
    await saveItemMutation.mutateAsync({ listId: itemsRow.id, values: { value: itemForm.value.trim(), label: itemForm.label || null, expiresAt: itemForm.expiresAt ?? null, remark: itemForm.remark || null } });
    Toast.success('已添加');
    setItemForm({ value: '', label: '', remark: '' });
  };

  const batchImport = async () => {
    if (!itemsRow) return;
    const values = importText.split(/[\n,;，；]+/).map((s) => s.trim()).filter(Boolean);
    if (values.length === 0) { Toast.warning('请粘贴要导入的值（换行或逗号分隔）'); return; }
    if (values.length > 500) { Toast.warning('单次最多导入 500 条'); return; }
    const res = await batchImportMutation.mutateAsync({ listId: itemsRow.id, values });
    Toast.success(res?.message ?? '导入完成');
    setImportText('');
  };

  const runCheck = async () => {
    if (!itemsRow || !checkValue.trim()) return;
    const res = await checkMutation.mutateAsync({ key: itemsRow.key, value: checkValue.trim() });
    if (res) setCheckResult(res);
  };

  const columns: ColumnProps<RuleList>[] = [
    { title: 'Key', dataIndex: 'key', width: 170, render: (t: string) => <Text code>{t}</Text> },
    { title: '名称', dataIndex: 'name', width: 170, render: renderEllipsis },
    { title: '类型', dataIndex: 'type', width: 90, render: (t: string) => <Tag size="small" color={TYPE_META[t]?.color}>{TYPE_META[t]?.text ?? t}</Tag> },
    { title: '条目数', dataIndex: 'itemCount', width: 90 },
    { title: '描述', dataIndex: 'description', render: renderEllipsis },
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (s: string) => <Tag color={s === 'enabled' ? 'green' : 'red'}>{s === 'enabled' ? '启用' : '停用'}</Tag> },
    createdAtColumn,
    createOperationColumn<RuleList>({
      desktopInlineKeys: ['items', 'edit'],
      actions: (r) => [
        { key: 'items', label: '条目', hidden: !canManageItems, onClick: () => openItems(r) },
        { key: 'edit', label: '编辑', hidden: !canEdit, onClick: () => openEdit(r) },
        { key: 'toggle', label: r.status === 'enabled' ? '停用' : '启用', danger: r.status === 'enabled', hidden: !canEdit, onClick: () => handleToggle(r) },
        { key: 'delete', label: '删除', danger: true, hidden: !canDelete, onClick: () => handleDelete(r) },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索名称" value={draftKeyword} onChange={setDraftKeyword} onEnterPress={() => { setPage(1); setSubmittedKeyword(draftKeyword); setSubmittedType(draftType); void queryClient.invalidateQueries({ queryKey: ruleKeys.ruleLists.lists }); }} showClear style={{ width: 200 }} />
            <Select placeholder="类型" value={draftType} onChange={(v) => setDraftType(v as string | undefined)} optionList={TYPE_OPTIONS} showClear style={{ width: 120 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); setSubmittedKeyword(draftKeyword); setSubmittedType(draftType); void queryClient.invalidateQueries({ queryKey: ruleKeys.ruleLists.lists }); }}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setDraftKeyword(''); setSubmittedKeyword(''); setDraftType(undefined); setSubmittedType(undefined); setPage(1); void queryClient.invalidateQueries({ queryKey: ruleKeys.ruleLists.lists }); }}>重置</Button>
            {canCreate && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
          </>
        )}
      />
      <ConfigurableTable bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据" pagination={buildPagination(data?.total ?? 0)} />

      <AppModal
        title={editing ? '编辑名单' : '新增名单'}
        visible={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={560}
        closeOnEsc
      >
        <Form key={editing?.id ?? 'new'} getFormApi={(a) => { formApi.current = a; }} labelPosition="left" labelWidth={80}
          initValues={editing ? { key: editing.key, name: editing.name, type: editing.type, description: editing.description } : { type: 'black' }}>
          <Form.Input field="key" label="Key" disabled={!!editing} rules={[{ required: true, message: 'key 必填' }]} placeholder="如 risk_blacklist" />
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '名称必填' }]} />
          <Form.Select field="type" label="类型" optionList={TYPE_OPTIONS} style={{ width: '100%' }} />
          <Form.TextArea field="description" label="描述" autosize={{ minRows: 2, maxRows: 3 }} maxCount={500} />
        </Form>
      </AppModal>

      <SideSheet title={`条目管理 · ${itemsRow?.name ?? ''}`} visible={!!itemsRow} onCancel={() => setItemsRow(null)} width={680}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ padding: 10, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
            <Text strong size="small">命中测试</Text>
            <Space spacing={8} style={{ marginTop: 6, width: '100%' }}>
              <Input size="small" value={checkValue} onChange={setCheckValue} placeholder="输入要检测的值" style={{ flex: 1 }} onEnterPress={runCheck} />
              <Button size="small" type="primary" loading={checkMutation.isPending} onClick={runCheck}>检测</Button>
              {checkResult && <Tag color={checkResult.hit ? 'red' : 'green'}>{checkResult.hit ? `命中${TYPE_META[checkResult.listType ?? '']?.text ?? ''}` : '未命中'}</Tag>}
            </Space>
          </div>
          <div style={{ padding: 10, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
            <Text strong size="small">新增条目</Text>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <Input size="small" value={itemForm.value} onChange={(v) => setItemForm((p) => ({ ...p, value: v }))} placeholder="值（必填）" style={{ width: 170 }} />
              <Input size="small" value={itemForm.label} onChange={(v) => setItemForm((p) => ({ ...p, label: v }))} placeholder="标签(可选)" style={{ width: 130 }} />
              <DatePicker size="small" type="dateTime" value={itemForm.expiresAt} onChange={(d) => setItemForm((p) => ({ ...p, expiresAt: d == null ? undefined : formatDateTimeForApi(d as Date) }))} placeholder="过期时间(可选)" style={{ width: 200 }} />
              <Input size="small" value={itemForm.remark} onChange={(v) => setItemForm((p) => ({ ...p, remark: v }))} placeholder="备注(可选)" style={{ width: 150 }} />
              <Button size="small" type="primary" loading={saveItemMutation.isPending} onClick={addItem}>添加</Button>
            </div>
            <div style={{ marginTop: 8 }}>
              <TextArea value={importText} onChange={setImportText} placeholder="批量导入：每行一个值（或用逗号分隔），最多 500 条" autosize={{ minRows: 2, maxRows: 5 }} />
              <Space spacing={8} style={{ marginTop: 6 }}>
                <Button size="small" loading={batchImportMutation.isPending} onClick={batchImport}>批量导入</Button>
                <Button size="small" theme="borderless" loading={purgeMutation.isPending} onClick={async () => { if (itemsRow) { const res = await purgeMutation.mutateAsync(itemsRow.id); Toast.success(res?.message ?? '清理完成'); } }}>清理过期条目</Button>
              </Space>
            </div>
          </div>
          <Space spacing={8}>
            <Input size="small" prefix={<Search size={12} />} value={itemKeyword} onChange={(v) => { setItemKeyword(v); setItemsPage(1); }} placeholder="按值搜索" showClear style={{ width: 200 }} />
            <Text type="tertiary" size="small">共 {items?.total ?? 0} 条</Text>
          </Space>
          <ConfigurableTable<RuleListItem>
            bordered
            size="small"
            rowKey="id"
            columns={[
              { title: '值', dataIndex: 'value', render: (t: string) => <Text code>{t}</Text> },
              { title: '标签', dataIndex: 'label', width: 120, render: (t: string | null) => t ?? '-' },
              { title: '过期时间', dataIndex: 'expiresAt', width: 160, render: (t: string | null) => t ?? '永久' },
              { title: '操作', width: 70, fixed: 'right', render: (_: unknown, item: RuleListItem) => (
                <Button theme="borderless" type="danger" size="small" onClick={async () => { if (itemsRow) { await deleteItemMutation.mutateAsync({ listId: itemsRow.id, itemId: item.id }); Toast.success('已删除'); } }}>删除</Button>
              ) },
            ]}
            dataSource={items?.list ?? []}
            loading={itemsQuery.isFetching}
            empty="暂无条目"
            pagination={{ currentPage: itemsPage, pageSize: 10, total: items?.total ?? 0, onPageChange: setItemsPage }}
          />
        </div>
      </SideSheet>
    </div>
  );
}
