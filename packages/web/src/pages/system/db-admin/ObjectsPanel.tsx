import { useState } from 'react';
import {
  Button, Collapse, Empty, Space, Spin, Tag, Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RefreshCw, ListOrdered, FunctionSquare, Zap, Tags, Package } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { AppModal } from '@/components/AppModal';
import { useDbAdminObjects, type DbAdminObjects } from '@/hooks/queries/db-admin';

const { Text } = Typography;

function fullName(schema: string, name: string): string {
  return schema === 'public' ? name : `${schema}.${name}`;
}

export function ObjectsPanel({ active }: Readonly<{ active: boolean }>) {
  const objectsQuery = useDbAdminObjects(active);
  const data = objectsQuery.data ?? null;
  const loading = objectsQuery.isFetching;
  const [defTitle, setDefTitle] = useState('');
  const [defText, setDefText] = useState<string | null>(null);

  const showDef = (title: string, text: string | null) => { setDefTitle(title); setDefText(text); };

  const seqColumns: ColumnProps<DbAdminObjects['sequences'][number]>[] = [
    { title: '名称', render: (_: unknown, r) => <Text strong>{fullName(r.schema, r.name)}</Text> },
    { title: '类型', dataIndex: 'dataType', width: 100 },
    { title: '当前值', dataIndex: 'lastValue', width: 120, render: (v: string | null) => v ?? <Text type="tertiary">未初始化</Text> },
    { title: '步长', dataIndex: 'incrementBy', width: 80 },
    { title: '起始值', dataIndex: 'startValue', width: 100 },
  ];

  const fnColumns: ColumnProps<DbAdminObjects['functions'][number]>[] = [
    { title: '名称', width: 220, render: (_: unknown, r) => <Text strong>{fullName(r.schema, r.name)}</Text> },
    { title: '类型', dataIndex: 'kind', width: 100, render: (v: string) => <Tag size="small" color="blue">{v}</Tag> },
    { title: '语言', dataIndex: 'language', width: 90 },
    { title: '参数', dataIndex: 'args', ellipsis: { showTitle: true }, render: (v: string) => <Text type="tertiary" size="small" style={{ fontFamily: 'monospace' }}>{v || '()'}</Text> },
    { title: '返回', dataIndex: 'result', width: 140, ellipsis: { showTitle: true } },
    createOperationColumn<DbAdminObjects['functions'][number]>({
      width: 100,
      actions: (record) => [
        {
          key: 'definition',
          label: '定义',
          disabled: !record.definition,
          onClick: () => showDef(`${fullName(record.schema, record.name)}`, record.definition),
        },
      ],
    }),
  ];

  const trgColumns: ColumnProps<DbAdminObjects['triggers'][number]>[] = [
    { title: '触发器', dataIndex: 'name', width: 220, render: (v: string) => <Text strong>{v}</Text> },
    { title: '表', width: 200, render: (_: unknown, r) => fullName(r.schema, r.table) },
    { title: '状态', dataIndex: 'enabled', width: 90, render: (v: boolean) => v ? <Tag size="small" color="green">启用</Tag> : <Tag size="small" color="grey">禁用</Tag> },
    createOperationColumn<DbAdminObjects['triggers'][number]>({
      width: 100,
      actions: (record) => [
        {
          key: 'definition',
          label: '定义',
          onClick: () => showDef(record.name, record.definition),
        },
      ],
    }),
  ];

  const enumColumns: ColumnProps<DbAdminObjects['enums'][number]>[] = [
    { title: '类型名', width: 240, render: (_: unknown, r) => <Text strong>{fullName(r.schema, r.name)}</Text> },
    { title: '取值', dataIndex: 'values', render: (v: string[]) => (
      <Space wrap spacing={4}>{v.map((x) => <Tag key={x} size="small" color="violet">{x}</Tag>)}</Space>
    )},
  ];

  const extColumns: ColumnProps<DbAdminObjects['extensions'][number]>[] = [
    { title: '扩展', dataIndex: 'name', width: 200, render: (v: string) => <Text strong>{v}</Text> },
    { title: '版本', dataIndex: 'version', width: 100, render: (v: string) => <Tag size="small">{v}</Tag> },
    { title: 'Schema', dataIndex: 'schema', width: 140 },
    { title: '说明', dataIndex: 'comment', render: (v: string | null) => v ?? <Text type="tertiary">-</Text> },
  ];

  const sectionHeader = (icon: React.ReactNode, title: string, count: number) => (
    <Space spacing={6}>{icon}<Text strong>{title}</Text><Text type="tertiary" size="small">{count}</Text></Space>
  );

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 4 }}>
      <Space style={{ marginBottom: 10 }}>
        <Button icon={<RefreshCw size={14} />} onClick={() => void objectsQuery.refetch()} loading={loading}>刷新</Button>
        {data && <Text type="tertiary" size="small">
          {data.sequences.length} 序列 · {data.functions.length} 函数 · {data.triggers.length} 触发器 · {data.enums.length} 枚举 · {data.extensions.length} 扩展
        </Text>}
      </Space>

      {loading && !data && <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>}
      {data && (
        <Collapse defaultActiveKey={['seq', 'fn', 'enum']} keepDOM={false}>
          <Collapse.Panel header={sectionHeader(<ListOrdered size={15} />, '序列', data.sequences.length)} itemKey="seq">
            {data.sequences.length === 0 ? <Empty title="无序列" style={{ padding: 16 }} /> : (
              <ConfigurableTable bordered columns={seqColumns} dataSource={data.sequences} rowKey={(r) => (r ? `${r.schema}.${r.name}` : '')} size="small" pagination={{ pageSize: 10 }} />
            )}
          </Collapse.Panel>
          <Collapse.Panel header={sectionHeader(<FunctionSquare size={15} />, '函数 / 存储过程', data.functions.length)} itemKey="fn">
            {data.functions.length === 0 ? <Empty title="无函数" style={{ padding: 16 }} /> : (
              <ConfigurableTable bordered columns={fnColumns} dataSource={data.functions} rowKey={(r) => (r ? `${r.schema}.${r.name}.${r.args}` : '')} size="small" pagination={{ pageSize: 10 }} scroll={{ x: 'max-content' }} />
            )}
          </Collapse.Panel>
          <Collapse.Panel header={sectionHeader(<Zap size={15} />, '触发器', data.triggers.length)} itemKey="trg">
            {data.triggers.length === 0 ? <Empty title="无触发器" style={{ padding: 16 }} /> : (
              <ConfigurableTable bordered columns={trgColumns} dataSource={data.triggers} rowKey={(r) => (r ? `${r.schema}.${r.table}.${r.name}` : '')} size="small" pagination={{ pageSize: 10 }} scroll={{ x: 'max-content' }} />
            )}
          </Collapse.Panel>
          <Collapse.Panel header={sectionHeader(<Tags size={15} />, '枚举类型', data.enums.length)} itemKey="enum">
            {data.enums.length === 0 ? <Empty title="无枚举类型" style={{ padding: 16 }} /> : (
              <ConfigurableTable bordered columns={enumColumns} dataSource={data.enums} rowKey={(r) => (r ? `${r.schema}.${r.name}` : '')} size="small" pagination={{ pageSize: 15 }} />
            )}
          </Collapse.Panel>
          <Collapse.Panel header={sectionHeader(<Package size={15} />, '扩展', data.extensions.length)} itemKey="ext">
            {data.extensions.length === 0 ? <Empty title="无扩展" style={{ padding: 16 }} /> : (
              <ConfigurableTable bordered columns={extColumns} dataSource={data.extensions} rowKey="name" size="small" pagination={false} />
            )}
          </Collapse.Panel>
        </Collapse>
      )}

      <AppModal title={`定义 · ${defTitle}`} visible={defText !== null} onCancel={() => setDefText(null)} footer={null} width={760}>
        <pre style={{ margin: 0, padding: 12, background: 'var(--semi-color-fill-0)', borderRadius: 6, maxHeight: '60vh', overflow: 'auto', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {defText}
        </pre>
      </AppModal>
    </div>
  );
}

ObjectsPanel.displayName = 'ObjectsPanel';
