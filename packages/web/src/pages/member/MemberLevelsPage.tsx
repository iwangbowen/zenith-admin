
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Space, Form, Toast, Tag, Row, Col, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { MemberLevel } from '@zenith/shared/member';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { renderEllipsis } from '../../utils/table-columns';
import { memberAdminKeys, useDeleteMemberLevel, useMemberLevels, useSaveMemberLevel, type MemberLevelFormValues } from '@/hooks/queries/member-admin';
import { useDictItems } from '@/hooks/useDictItems';
import { CreateButton, RefreshButton } from '@/components/toolbar-controls';
import { confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';

export default function MemberLevelsPage() {
  const navigate = useNavigate();
  const { items: statusItems } = useDictItems('common_status');
  const statusOptions = statusItems.map((i) => ({ value: i.value, label: i.label }));
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const listQuery = useMemberLevels();
  const data = listQuery.data ?? [];
  const saveMutation = useSaveMemberLevel();
  const deleteMutation = useDeleteMemberLevel();

  const levelModal = useEditModal<MemberLevel, MemberLevelFormValues>({
    entityName: '等级',
    save: saveMutation,
    defaults: { level: 0, growthThreshold: 0, discount: 100, sort: 0, status: 'enabled' as const, benefits: [] },
    toValues: (record) => ({ name: record.name, level: record.level, growthThreshold: record.growthThreshold, discount: record.discount, benefits: record.benefits, description: record.description, sort: record.sort, status: record.status }),
  });

  const handleDelete = (record: MemberLevel) => {
    confirmDelete({
      title: `确认删除等级「${record.name}」？`,
      content: '删除后该等级下会员的等级将被置空。',
      onOk: async () => {
        await deleteMutation.mutateAsync({ params: { id: record.id } });
        Toast.success('删除成功');
      },
    });
  };

  const columns: ColumnProps<MemberLevel>[] = [
    { title: '等级名称', dataIndex: 'name', minWidth: 140, render: renderEllipsis },
    { title: '等级序号', dataIndex: 'level', width: 90, align: 'right' },
    { title: '成长值门槛', dataIndex: 'growthThreshold', width: 110, align: 'right' },
    { title: '折扣', dataIndex: 'discount', width: 90, align: 'right', render: (v: number) => (v >= 100 ? '无' : `${(v / 10).toFixed(1)}折`) },
    { title: '会员数', dataIndex: 'memberCount', width: 90, align: 'right', render: (v: number | undefined, r: MemberLevel) => (
      (v ?? 0) > 0
        ? <Typography.Text link onClick={() => navigate(`/member/members?levelId=${r.id}`)}>{v}</Typography.Text>
        : 0
    ) },
    { title: '权益', dataIndex: 'benefits', width: 220, render: (v: string[]) => (v?.length ? <Space wrap spacing={4}>{v.map((b, i) => <Tag key={i} color="light-blue">{b}</Tag>)}</Space> : '-') },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (v: string) => <Tag color={v === 'enabled' ? 'green' : 'grey'}>{v === 'enabled' ? '启用' : '停用'}</Tag>,
    },
    createOperationColumn<MemberLevel>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !hasPermission('member:level:update'), onClick: () => levelModal.openEdit(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !hasPermission('member:level:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const renderRefreshButton = () => (
    <RefreshButton onClick={() => void queryClient.invalidateQueries({ queryKey: memberAdminKeys.levels })} />
  );

  const renderCreateButton = () => hasPermission('member:level:create') ? (
    <CreateButton onClick={levelModal.openCreate}>新增等级</CreateButton>
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

      <AppModal {...levelModal.modalProps} width={660}>
        <Form key={levelModal.formKey} {...levelModal.formProps}>
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
