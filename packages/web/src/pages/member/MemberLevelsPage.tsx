import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Space, Modal, Form, Toast, Tag, Row, Col } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw } from 'lucide-react';
import type { MemberLevel } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { renderEllipsis } from '../../utils/table-columns';
import { memberAdminKeys, useDeleteMemberLevel, useMemberLevels, useSaveMemberLevel } from '@/hooks/queries/member-admin';
import { useDictItems } from '@/hooks/useDictItems';

export default function MemberLevelsPage() {
  const { items: statusItems } = useDictItems('common_status');
  const statusOptions = statusItems.map((i) => ({ value: i.value, label: i.label }));
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<MemberLevel | null>(null);
  const listQuery = useMemberLevels();
  const data = listQuery.data ?? [];
  const saveMutation = useSaveMemberLevel();
  const deleteMutation = useDeleteMemberLevel();

  const openCreate = () => { setEditing(null); setModalVisible(true); };
  const openEdit = (record: MemberLevel) => { setEditing(record); setModalVisible(true); };

  const handleModalOk = async () => {
    let values;
    try { values = await formApi.current!.validate(); } catch { throw new Error('validation'); }
    await saveMutation.mutateAsync({ id: editing?.id, values });
    Toast.success(editing ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditing(null);
  };

  const handleDelete = (record: MemberLevel) => {
    Modal.confirm({
      title: `确认删除等级「${record.name}」？`,
      content: '删除后该等级下会员的等级将被置空。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(record.id);
        Toast.success('删除成功');
      },
    });
  };

  const formInit = editing
    ? { name: editing.name, level: editing.level, growthThreshold: editing.growthThreshold, discount: editing.discount, benefits: editing.benefits, description: editing.description, sort: editing.sort, status: editing.status }
    : { level: 0, growthThreshold: 0, discount: 100, sort: 0, status: 'enabled' as const, benefits: [] };

  const columns: ColumnProps<MemberLevel>[] = [
    { title: '等级名称', dataIndex: 'name', width: 140, render: renderEllipsis },
    { title: '等级序号', dataIndex: 'level', width: 90 },
    { title: '成长值门槛', dataIndex: 'growthThreshold', width: 110 },
    { title: '折扣', dataIndex: 'discount', width: 90, render: (v: number) => (v >= 100 ? '无' : `${(v / 10).toFixed(1)}折`) },
    { title: '会员数', dataIndex: 'memberCount', width: 90, render: (v?: number) => v ?? 0 },
    { title: '权益', dataIndex: 'benefits', width: 220, render: (v: string[]) => (v?.length ? <Space wrap spacing={4}>{v.map((b, i) => <Tag key={i} color="light-blue">{b}</Tag>)}</Space> : '-') },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (v: string) => <Tag color={v === 'enabled' ? 'green' : 'grey'}>{v === 'enabled' ? '启用' : '停用'}</Tag>,
    },
    createOperationColumn<MemberLevel>({
      width: 130,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !hasPermission('member:level:update'), onClick: () => openEdit(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !hasPermission('member:level:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const renderRefreshButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => void queryClient.invalidateQueries({ queryKey: memberAdminKeys.levels })}>刷新</Button>
  );

  const renderCreateButton = () => hasPermission('member:level:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增等级</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderRefreshButton()}
            {renderCreateButton()}
          </>
        )}
      />

      <ConfigurableTable bordered columns={columns} dataSource={data} loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} rowKey="id" size="small" pagination={false} empty="暂无数据" />

      <AppModal title={editing ? '编辑等级' : '新增等级'} visible={modalVisible} width={660}
        onCancel={() => { setModalVisible(false); setEditing(null); }} onOk={handleModalOk}>
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} allowEmpty
          initValues={formInit} labelPosition="left" labelWidth={90}>
          <Row gutter={16}>
            <Col span={12}><Form.Input field="name" label="等级名称" placeholder="如：黄金会员" rules={[{ required: true, message: '请输入等级名称' }]} /></Col>
            <Col span={12}><Form.InputNumber field="level" label="等级序号" min={0} style={{ width: '100%' }} rules={[{ required: true, message: '请输入序号' }]} /></Col>
            <Col span={12}><Form.InputNumber field="growthThreshold" label="成长值门槛" min={0} style={{ width: '100%' }} /></Col>
            <Col span={12}><Form.InputNumber field="discount" label="折扣(%)" min={1} max={100} style={{ width: '100%' }} suffix="%" /></Col>
            <Col span={12}><Form.InputNumber field="sort" label="排序" min={0} style={{ width: '100%' }} /></Col>
            <Col span={12}><Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusOptions} /></Col>
          </Row>
          <Form.TagInput field="benefits" label="权益说明" placeholder="输入权益后回车，如：生日礼券" />
          <Form.TextArea field="description" label="描述" placeholder="请输入等级描述" maxCount={256} />
        </Form>
      </AppModal>
    </div>
  );
}
