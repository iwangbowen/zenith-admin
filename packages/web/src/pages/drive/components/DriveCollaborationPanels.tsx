import { useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { Button, Descriptions, Empty, Form, List, Select, Space, Spin, Timeline, Toast, Typography } from '@douyinfe/semi-ui';
import { DRIVE_ACTIVITY_ACTION_LABELS, driveMetadataSchema, type CreateDriveTagInput, type DriveNode, type DriveNodeProfile, type DriveSpace, type DriveTag, type UpdateDriveNodeProfileInput } from '@zenith/shared/drive';
import { AppModal } from '@/components/AppModal';
import { ListPagination } from '@/components/ListPagination';
import { useEditModal } from '@/hooks/useEditModal';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useDriveProfile, useDriveSpaceActivities, useDriveSubscription, useMergeDriveTags, useSaveDriveProfile, useSubscribeDriveNode } from '@/hooks/queries/drive-collaboration';
import { useCreateDriveTag, useDeleteDriveTag, useDriveTags, useUpdateDriveTag } from '@/hooks/queries/drive';
import { abortSubmit } from '@/lib/abort-submit';
import { confirmDelete } from '@/utils/confirm';
import { roleAtLeast } from '../drive-utils';

export function DriveSubscriptionButton({ nodeId }: { readonly nodeId: number }) {
  const query = useDriveSubscription(nodeId);
  const subscribe = useSubscribeDriveNode();
  return <Button size="small" icon={query.data ? <BellOff size={14} /> : <Bell size={14} />}
    loading={query.isFetching || subscribe.isPending} disabled={query.isError}
    onClick={() => subscribe.mutate({ params: { id: nodeId }, body: { subscribed: !query.data } })}>
    {query.data ? '取消关注' : '关注变更'}
  </Button>;
}

export function DriveProfilePanel({ node }: { readonly node: DriveNode }) {
  const query = useDriveProfile(node.id);
  const save = useSaveDriveProfile(node.spaceId);
  const { hasPermission } = usePermission();
  const modal = useEditModal<DriveNodeProfile & { id: number }, { description: string; metadataJson: string }, UpdateDriveNodeProfileInput>({
    entityName: '文件属性',
    save: { isPending: save.isPending, mutateAsync: async ({ values }) => {
      const profile = await save.mutateAsync({ params: { id: node.id }, body: values });
      return { ...profile, id: profile.nodeId };
    } },
    toValues: (profile) => ({ description: profile.description ?? '', metadataJson: JSON.stringify(profile.metadata, null, 2) }),
    beforeSave: (values) => {
      let metadata: unknown;
      try { metadata = JSON.parse(values.metadataJson || '{}'); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        Toast.warning('自定义属性需要是有效的 JSON 对象');
        return abortSubmit();
      }
      const parsed = driveMetadataSchema.safeParse(metadata);
      if (!parsed.success) { Toast.warning(parsed.error.issues[0].message); return abortSubmit(); }
      return { description: values.description.trim() || null, metadata: parsed.data };
    },
  });
  const profile = query.data;
  return <div className="drive-panel">
    <Spin spinning={query.isFetching}>
      {query.isError ? <Empty title="属性读取失败"><Button onClick={() => void query.refetch()}>重试</Button></Empty> : <>
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{profile?.description || '尚未填写文件说明'}</Typography.Paragraph>
        <Descriptions align="left" data={Object.entries(profile?.metadata ?? {}).map(([key, value]) => ({ key, value: String(value ?? '') }))} />
        {profile && roleAtLeast(node.myRole, 'editor') && hasPermission('drive:node:edit')
          && <Button onClick={() => modal.openEdit({ ...profile, id: node.id })}>编辑说明与属性</Button>}
      </>}
    </Spin>
    <AppModal {...modal.modalProps} width={620}>
      <Form key={modal.formKey} {...modal.formProps}>
        <Form.TextArea field="description" label="文件说明" maxLength={2000} autosize />
        <Form.TextArea field="metadataJson" label="自定义属性" autosize={{ minRows: 5, maxRows: 14 }} extraText="JSON 对象，最多 30 项；值支持文字、数字、布尔和 null。" />
      </Form>
    </AppModal>
  </div>;
}

export function DriveSpaceActivitiesModal({ space, onClose }: { readonly space: DriveSpace | null; readonly onClose: () => void }) {
  const { page, pageSize, buildPagination } = usePagination(20);
  const query = useDriveSpaceActivities(space?.id, { page, pageSize });
  return <AppModal title={`空间动态 · ${space?.name ?? ''}`} visible={!!space} onCancel={onClose} closeOnEsc footer={null} width={720}>
    <Spin spinning={!!space && query.isFetching}>
      <Timeline>{(query.data?.list ?? []).map((activity) => <Timeline.Item key={activity.id} time={activity.createdAt}>
        {activity.actorName ?? '匿名访客'} {DRIVE_ACTIVITY_ACTION_LABELS[activity.action]}「{activity.nodeName}」
      </Timeline.Item>)}</Timeline>
      {!query.isPending && !query.data?.list.length && <Empty description="暂无可见动态" />}
      <ListPagination pagination={buildPagination(query.data?.total ?? 0)} />
    </Spin>
  </AppModal>;
}

function SpaceTagEditor({ space }: { readonly space: DriveSpace }) {
  const query = useDriveTags(space.id);
  const create = useCreateDriveTag();
  const update = useUpdateDriveTag();
  const remove = useDeleteDriveTag();
  const merge = useMergeDriveTags(space.id);
  const [merging, setMerging] = useState<DriveTag | null>(null);
  const [targetId, setTargetId] = useState<number>();
  const { hasPermission } = usePermission();
  const canEdit = roleAtLeast(space.myRole, 'editor') && hasPermission('drive:node:edit');
  const modal = useEditModal<DriveTag, Partial<CreateDriveTagInput>>({
    entityName: '标签', defaults: { name: '', color: '' },
    save: { isPending: create.isPending || update.isPending, mutateAsync: ({ id, values }) => id
      ? update.mutateAsync({ params: { id }, body: { name: values.name, color: values.color } })
      : create.mutateAsync({ body: { spaceId: space.id, name: values.name ?? '', color: values.color } }) },
  });
  return <>
    {canEdit && <Button onClick={modal.openCreate}>新增标签</Button>}
    <List dataSource={query.data ?? []} loading={query.isFetching} emptyContent={<Empty description="暂无标签" />}
      renderItem={(tag) => <List.Item main={<Space><Typography.Text strong>{tag.name}</Typography.Text><Typography.Text type="tertiary">{tag.color}</Typography.Text></Space>}
        extra={canEdit ? <Space>
          <Button size="small" theme="borderless" onClick={() => modal.openEdit(tag)}>编辑</Button>
          <Button size="small" theme="borderless" onClick={() => { setMerging(tag); setTargetId(undefined); }}>合并</Button>
          <Button size="small" theme="borderless" type="danger" onClick={() => confirmDelete({ title: `删除标签「${tag.name}」？`, onOk: () => remove.mutateAsync({ params: { id: tag.id }, spaceId: space.id }) })}>删除</Button>
        </Space> : undefined} />} />
    <AppModal {...modal.modalProps} width={460}><Form key={modal.formKey} {...modal.formProps}>
      <Form.Input field="name" label="名称" maxLength={50} rules={[{ required: true }]} />
      <Form.Input field="color" label="颜色" maxLength={20} placeholder="如 blue 或 #1677ff" />
    </Form></AppModal>
    <AppModal title="合并标签" visible={!!merging} onCancel={() => setMerging(null)} closeOnEsc width={460}
      okButtonProps={{ disabled: !targetId, loading: merge.isPending }} onOk={async () => {
        if (!merging || !targetId) { Toast.warning('请选择目标标签'); return abortSubmit(); }
        await merge.mutateAsync({ params: { id: merging.id }, body: { targetId } });
        setMerging(null);
      }}>
      <Typography.Paragraph>「{merging?.name}」将删除，其文件关联并入目标标签。</Typography.Paragraph>
      <Select value={targetId} placeholder="选择目标标签" style={{ width: '100%' }}
        optionList={(query.data ?? []).filter((tag) => tag.id !== merging?.id).map((tag) => ({ value: tag.id, label: tag.name }))}
        onChange={(value) => setTargetId(typeof value === 'number' ? value : undefined)} />
    </AppModal>
  </>;
}

export function DriveTagsModal({ space, onClose }: { readonly space: DriveSpace | null; readonly onClose: () => void }) {
  return <AppModal title={`标签管理 · ${space?.name ?? ''}`} visible={!!space} onCancel={onClose} closeOnEsc footer={null} width={680}>
    {space && <SpaceTagEditor key={space.id} space={space} />}
  </AppModal>;
}
