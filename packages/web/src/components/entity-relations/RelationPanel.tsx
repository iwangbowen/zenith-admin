import { useState } from 'react';
import { Button, Card, Empty, Space, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import type { EntityRelationSection, CanonicalEntityType } from '@zenith/shared/platform';
import { useEntityRelationSection, useEntityRelations } from '@/hooks/queries/entity-relations';

interface RelationPanelProps {
  readonly entityType: CanonicalEntityType;
  readonly entityKey: string | undefined;
  readonly enabled?: boolean;
}

function RelationSectionView({
  entityType,
  entityKey,
  section,
  active,
  onActivate,
}: {
  readonly entityType: CanonicalEntityType;
  readonly entityKey: string;
  readonly section: EntityRelationSection;
  readonly active: boolean;
  readonly onActivate: () => void;
}) {
  const query = useEntityRelationSection(entityType, entityKey, section.key, active);
  const items = query.data?.items ?? [];
  return (
    <Card
      bordered
      style={{ marginBottom: 8 }}
      bodyStyle={{ padding: 12 }}
      headerLine={false}
      title={(
        <Space>
          <Typography.Text strong>{section.labelKey}</Typography.Text>
          {query.data?.total !== undefined && <Tag size="small">{query.data.total}</Tag>}
        </Space>
      )}
      headerExtraContent={(
        <Button theme="borderless" size="small" onClick={onActivate} loading={active && query.isFetching}>
          {active ? '刷新' : '查看'}
        </Button>
      )}
    >
      {!active && <Typography.Text type="tertiary">展开查看关联记录</Typography.Text>}
      {active && query.isLoading && <Spin size="small" />}
      {active && query.isError && (
        <Space>
          <Typography.Text type="danger">关联记录加载失败</Typography.Text>
          <Button size="small" onClick={() => void query.refetch()}>重试</Button>
        </Space>
      )}
      {active && !query.isLoading && !query.isError && items.length === 0 && <Empty description="暂无关联记录" />}
      {active && items.length > 0 && (
        <Space vertical spacing="tight" style={{ width: '100%' }}>
          {items.map((item) => (
            <div key={`${item.ref.type}:${item.ref.key}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}>
              <div style={{ minWidth: 0 }}>
                <Typography.Text ellipsis={{ showTooltip: true }}>{item.title}</Typography.Text>
                {item.subtitle && <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }}>{item.subtitle}</Typography.Text>}
              </div>
              {item.status && <Tag size="small">{item.status}</Tag>}
            </div>
          ))}
          {query.data?.hasMore && <Typography.Text type="tertiary" size="small">还有更多记录，请进入对应业务列表查看</Typography.Text>}
        </Space>
      )}
    </Card>
  );
}

export default function RelationPanel({ entityType, entityKey, enabled = true }: RelationPanelProps) {
  const query = useEntityRelations(entityType, entityKey, enabled);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  if (!enabled || !entityKey) return null;
  if (query.isLoading) return <Spin size="small" />;
  if (query.isError) {
    return (
      <Space>
        <Typography.Text type="danger">关联信息加载失败</Typography.Text>
        <Button size="small" onClick={() => void query.refetch()}>重试</Button>
      </Space>
    );
  }
  const sections = query.data?.sections ?? [];
  if (sections.length === 0) return <Empty description="暂无可见关联信息" />;

  return (
    <div>
      {sections.map((section) => (
        <RelationSectionView
          key={section.key}
          entityType={entityType}
          entityKey={entityKey}
          section={section}
          active={activeSection === section.key}
          onActivate={() => setActiveSection((current) => current === section.key ? null : section.key)}
        />
      ))}
    </div>
  );
}
