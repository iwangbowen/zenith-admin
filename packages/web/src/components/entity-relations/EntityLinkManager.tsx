import { useId, useState } from 'react';
import { Button, Empty, Input, List, Select, Space, Spin, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import { Plus } from 'lucide-react';
import { MANUAL_RELATION_OPTIONS, SEARCH_TYPE_ENTITY_TYPES, supportsEntityRelations, type CanonicalEntityRef, type ManualRelationType } from '@zenith/shared/platform';
import { AppModal } from '@/components/AppModal';
import { useGlobalSearch } from '@/hooks/queries/global-search';
import { useLinkEntity } from '@/hooks/queries/entity-relations';
import { entityTypeLabel } from '@/utils/entity-relations';

function LinkDialog({ anchor, onClose }: { readonly anchor: CanonicalEntityRef; readonly onClose: () => void }) {
  const typeLabelId = useId();
  const [keyword, setKeyword] = useState('');
  const [relationType, setRelationType] = useState<ManualRelationType>('related');
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<{ ref: CanonicalEntityRef; title: string } | null>(null);
  const search = useGlobalSearch(keyword, true, undefined, 20);
  const link = useLinkEntity();
  const results = (search.data?.results ?? []).filter((item) => {
    if (item.actions?.view === false) return false;
    const type = SEARCH_TYPE_ENTITY_TYPES[item.type];
    return supportsEntityRelations(type) && !(type === anchor.type && String(item.id) === anchor.key);
  });
  return <AppModal title="添加关联对象" visible width={640} closeOnEsc onCancel={onClose} okText="建立关联"
    okButtonProps={{ disabled: !selected, loading: link.isPending }} onOk={async () => {
      if (!selected) return;
      await link.mutateAsync({ params: anchor, body: { target: selected.ref, relationType, note } });
      Toast.success('已建立关联');
      onClose();
    }}>
    <Space vertical align="start" style={{ width: '100%', marginBottom: 12 }}>
      <Typography.Text id={typeLabelId}>关联类型</Typography.Text>
      <Select aria-labelledby={typeLabelId} value={relationType} optionList={MANUAL_RELATION_OPTIONS} onChange={(value) => setRelationType(value as ManualRelationType)} style={{ width: 180 }} />
      <Typography.Text type="tertiary">选择目标对象作为当前对象的相关对象、补充材料、参考依据或后续处理事项。</Typography.Text>
      <TextArea aria-label="关联说明" value={note} onChange={setNote} placeholder="关联说明（选填）" maxCount={500} rows={2} />
    </Space>
    <Input value={keyword} onChange={(value) => { setKeyword(value); setSelected(null); }} placeholder="搜索用户、订单、流程、内容或设备" showClear />
    {selected && <Typography.Paragraph style={{ marginTop: 12 }}>已选择：{entityTypeLabel(selected.ref.type)} · {selected.title}</Typography.Paragraph>}
    {search.isFetching ? <Spin style={{ marginTop: 16 }} /> : keyword.trim().length < 2 ? <Empty description="输入至少 2 个字符查找对象" /> : search.isError ?
      <Space><Typography.Text type="danger">搜索暂时不可用</Typography.Text><Button onClick={() => void search.refetch()}>重试</Button></Space> :
      results.length === 0 ? <Empty description="没有找到可关联对象" /> :
      <List size="small" split dataSource={results} style={{ maxHeight: 360, overflowY: 'auto' }} renderItem={(item) => {
        const ref = { type: SEARCH_TYPE_ENTITY_TYPES[item.type], key: String(item.id) };
        const active = selected?.ref.type === ref.type && selected.ref.key === ref.key;
        return <List.Item key={`${ref.type}:${ref.key}`} extra={<Button size="small" theme={active ? 'solid' : 'borderless'} onClick={() => setSelected({ ref, title: item.title })}>{active ? '已选择' : '选择'}</Button>}
          main={<div style={{ minWidth: 0 }}>
            <Typography.Text strong>{item.title}</Typography.Text>
            <div><Typography.Text type="tertiary">{entityTypeLabel(ref.type)}{item.subtitle ? ` · ${item.subtitle}` : ''}</Typography.Text></div>
          </div>} />;
      }} />}
  </AppModal>;
}

export default function EntityLinkManager({ anchor }: { readonly anchor: CanonicalEntityRef }) {
  const [visible, setVisible] = useState(false);
  return <>
    <Button size="small" theme="borderless" icon={<Plus size={14} />} onClick={() => setVisible(true)}>添加关联</Button>
    {visible && <LinkDialog anchor={anchor} onClose={() => setVisible(false)} />}
  </>;
}
