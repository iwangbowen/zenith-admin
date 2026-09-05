/**
 * 开放授权弹窗（Headless 写入的 fail-closed 边界）：
 * 开放应用持有 cms:write 只代表能调写接口，能写哪个站点由此处授权决定。
 */
import { useMemo, useState } from 'react';
import { Button, Checkbox, Input, Select, Space, Tag, Toast } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { confirmDelete } from '@/utils/confirm';
import { useCmsChannelTree, useCmsOpenGrants, useDeleteCmsOpenGrant, useSaveCmsOpenGrant } from '@/hooks/queries/cms';
import type { CmsChannel, CmsOpenAppGrant, CmsSite } from '@zenith/shared/cms';

interface SiteOpenGrantsModalProps {
  readonly site: CmsSite | null;
  readonly onClose: () => void;
}

const EMPTY_DRAFT = { clientId: '', channelIds: [] as number[], canPublish: false };

export default function SiteOpenGrantsModal({ site, onClose }: Readonly<SiteOpenGrantsModalProps>) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const grantsQuery = useCmsOpenGrants(site?.id, !!site);
  const saveGrantMutation = useSaveCmsOpenGrant();
  const deleteGrantMutation = useDeleteCmsOpenGrant();
  const grantChannelsQuery = useCmsChannelTree(site?.id);
  const channelOptions = useMemo(() => {
    const flatten = (nodes: CmsChannel[], depth = 0): { value: number; label: string }[] =>
      nodes.flatMap((node) => [
        { value: node.id, label: `${'　'.repeat(depth)}${node.name}` },
        ...(node.children ? flatten(node.children, depth + 1) : []),
      ]);
    return flatten(grantChannelsQuery.data ?? []);
  }, [grantChannelsQuery.data]);

  async function handleSaveGrant() {
    if (!site || !draft.clientId.trim()) {
      Toast.warning('请填写开放应用 AppKey');
      return;
    }
    await saveGrantMutation.mutateAsync({ params: { id: site.id }, body: { ...draft, clientId: draft.clientId.trim() } });
    setDraft(EMPTY_DRAFT);
    Toast.success('授权已保存');
  }

  return (
    <AppModal
      title={site ? `「${site.name}」开放授权` : '开放授权'}
      visible={!!site}
      onCancel={onClose}
      footer={null}
      width={720}
      closeOnEsc
    >
      <div style={{ marginBottom: 12, color: 'var(--semi-color-text-2)', fontSize: 13 }}>
        开放应用持有 <code>cms:write</code> 只代表能调写接口，能写哪个站点由此处决定：**未在此授权的应用一律拒绝**。
        栏目留空表示该站点全部栏目。「允许直接发布」还需应用同时持有 <code>cms:publish</code>，
        且在站点编辑 →「内容策略」中开启「允许开放 API 直接发布」。
      </div>
      <Space wrap align="end" style={{ marginBottom: 12, width: '100%' }}>
        <Input
          placeholder="开放应用 AppKey"
          value={draft.clientId}
          onChange={(v) => setDraft((d) => ({ ...d, clientId: v }))}
          style={{ width: 220 }}
        />
        <Select
          multiple
          filter
          placeholder="可写栏目（留空 = 全部）"
          value={draft.channelIds}
          onChange={(v) => setDraft((d) => ({ ...d, channelIds: (v as number[]) ?? [] }))}
          optionList={channelOptions}
          style={{ width: 240 }}
        />
        <Checkbox
          checked={draft.canPublish}
          onChange={(e: { target: { checked?: boolean } }) => setDraft((d) => ({ ...d, canPublish: e.target.checked === true }))}
        >
          允许直接发布
        </Checkbox>
        <Button type="primary" loading={saveGrantMutation.isPending} onClick={() => void handleSaveGrant()}>
          保存授权
        </Button>
      </Space>
      <ConfigurableTable
        bordered
        size="small"
        rowKey="id"
        loading={grantsQuery.isFetching}
        dataSource={grantsQuery.data ?? []}
        pagination={false}
        empty="尚未授权任何开放应用"
        columns={[
          { title: 'AppKey', dataIndex: 'clientId', width: 180 },
          { title: '应用', dataIndex: 'appName', width: 140, render: (v: string | null) => v ?? '-' },
          {
            title: '可写栏目', dataIndex: 'channelIds', minWidth: 160,
            render: (v: number[]) => (v?.length ? `${v.length} 个栏目` : <Tag size="small" color="blue">全部栏目</Tag>),
          },
          {
            title: '直接发布', dataIndex: 'canPublish', width: 100,
            render: (v: boolean) => (v ? <Tag size="small" color="orange">允许</Tag> : <Tag size="small" color="grey">禁止</Tag>),
          },
          {
            title: '状态', dataIndex: 'status', width: 90,
            render: (v: string) => (v === 'enabled' ? <Tag size="small" color="green">启用</Tag> : <Tag size="small" color="grey">停用</Tag>),
          },
          createOperationColumn<CmsOpenAppGrant>({
            width: 100,
            desktopInlineKeys: ['delete'],
            actions: (record) => [{
              key: 'delete',
              label: '删除',
              danger: true,
              onClick: () => { confirmDelete({
                title: `删除对「${record.clientId}」的授权？`,
                content: '删除后该应用将无法再写入本站点。',
                onOk: async () => {
                  await deleteGrantMutation.mutateAsync({ params: { grantId: record.id } });
                  Toast.success('已删除');
                },
              }); },
            }],
          }),
        ]}
      />
    </AppModal>
  );
}
