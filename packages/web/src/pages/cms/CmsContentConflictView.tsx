import type { CSSProperties } from 'react';
import { Empty, Space, Tag, Typography } from '@douyinfe/semi-ui';
import type { CmsChannel, CmsContent, CmsModel, CmsModelField, CmsTag } from '@zenith/shared/cms';
import type { UserSelectOptionSource } from '@/components/UserSelect';
import { flattenChannels } from './channel-tree';
import { buildCmsContentConflictRows, cmsConflictValueText } from './cms-content-conflicts';

const CHANGES = { server: '服务端修改', local: '本地修改', both: '双方修改不同', same: '双方修改一致' } as const;

export default function CmsContentConflictView({ base, server, local, fields, channels, models, users, tags }: Readonly<{
  base: Record<string, unknown>; server?: CmsContent; local: Record<string, unknown>; fields: readonly CmsModelField[];
  channels?: CmsChannel[]; models?: CmsModel[]; users?: readonly UserSelectOptionSource[]; tags?: CmsTag[];
}>) {
  if (!server) return <Typography.Text>正在加载服务器稿件…</Typography.Text>;
  const rows = buildCmsContentConflictRows(base, server, local, fields);
  const names = {
    channels: new Map(flattenChannels(channels ?? []).map((item) => [item.id, item.name])),
    models: new Map((models ?? []).map((item) => [item.id, item.name])),
    users: new Map((users ?? []).map((item) => [item.id, item.nickname])),
    tags: new Map((tags ?? []).map((item) => [item.id, item.name])),
  };
  if (!rows.length) return <Empty title="业务字段没有差异" description="可采用服务器稿继续编辑。" />;
  return <div style={{ maxHeight: '62vh', overflow: 'auto', marginTop: 16 }}>
    {rows.map((row) => <section key={row.key} style={{ marginBottom: 20 }}>
      <Space wrap><Typography.Title heading={6} style={{ margin: 0 }}>{row.label}</Typography.Title><Tag color={row.change === 'both' ? 'orange' : row.change === 'same' ? 'green' : 'blue'}>{CHANGES[row.change]}</Tag></Space>
      <div className="auto-grid" style={{ '--auto-grid-cols': 3, marginTop: 8 } as CSSProperties}>
        {([['原始基稿', row.base], ['服务器最新稿', row.server], ['本地修改', row.local]] as const).map(([label, value]) => <div key={label} style={{ minWidth: 0, padding: 12, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)' }}>
          <Typography.Text type="tertiary">{label}</Typography.Text>
          <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto' }}>{cmsConflictValueText(row, value, names)}</div>
        </div>)}
      </div>
    </section>)}
  </div>;
}
