import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Toast,
  Tooltip,
} from '@douyinfe/semi-ui';
import { Search, RotateCcw, Trash2 } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';

interface CacheItem {
  key: string;
  displayKey: string;
  type: string;
  ttl: number;
  size: number;
  value: string | null;
}

const TYPE_COLORS: Record<string, 'blue' | 'green' | 'orange' | 'purple' | 'cyan'> = {
  string: 'blue',
  list: 'green',
  hash: 'orange',
  set: 'purple',
  zset: 'cyan',
};

function TtlBadge({ ttl }: Readonly<{ ttl: number }>) {
  if (ttl === -1) return <Tag color="grey" size="small">永久</Tag>;
  if (ttl <= 0) return <Tag color="red" size="small">已过期</Tag>;
  const hours = Math.floor(ttl / 3600);
  const minutes = Math.floor((ttl % 3600) / 60);
  const seconds = ttl % 60;
  let text: string;
  if (hours > 0) text = `${hours}h ${minutes}m`;
  else if (minutes > 0) text = `${minutes}m ${seconds}s`;
  else text = `${seconds}s`;
  let color: 'orange' | 'yellow' | 'green';
  if (ttl < 300) color = 'orange';
  else if (ttl < 3600) color = 'yellow';
  else color = 'green';
  return <Tag color={color} size="small">{text}</Tag>;
}

export default function CacheManagePage() {
  const { hasPermission } = usePermission();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CacheItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const fetchData = useCallback(async (kw = keyword) => {
    setLoading(true);
    try {
      const params = kw ? `?keyword=${encodeURIComponent(kw)}` : '';
      const res = await request.get<{ list: CacheItem[]; total: number }>(`/api/cache${params}`);
      if (res.code === 0) {
        setData(res.data.list);
      }
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  useEffect(() => {
    void fetchData('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => {
    setKeyword(searchInput);
    void fetchData(searchInput);
  };

  const handleReset = () => {
    setSearchInput('');
    setKeyword('');
    void fetchData('');
  };

  const handleDelete = (item: CacheItem) => {
    Modal.confirm({
      title: '确定要删除该缓存吗？',
      content: <span>Key：<code>{item.displayKey}</code></span>,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete<null>('/api/cache', { key: item.key });
        if (res.code === 0) {
          Toast.success('删除成功');
          void fetchData(keyword);
        }
      },
    });
  };

  const handleClearAll = () => {
    Modal.confirm({
      title: '确定要清空所有缓存吗？',
      content: '此操作将删除当前命名空间下的全部缓存，包括会话数据，操作不可撤销，请谨慎！',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete<{ count: number }>('/api/cache/all', {});
        if (res.code === 0) {
          Toast.success(`已清空 ${res.data?.count ?? 0} 条缓存`);
          void fetchData(keyword);
        }
      },
    });
  };

  const columns: ColumnProps<CacheItem>[] = [
    {
      title: 'Key',
      dataIndex: 'displayKey',
      ellipsis: true,
      render: (v: string) => (
        <Tooltip content={v}>
          <code style={{ fontSize: 12 }}>{v}</code>
        </Tooltip>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (v: string) => (
        <Tag color={TYPE_COLORS[v] ?? 'grey'} size="small">{v}</Tag>
      ),
    },
    {
      title: '剩余 TTL',
      dataIndex: 'ttl',
      width: 120,
      render: (v: number) => <TtlBadge ttl={v} />,
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 90,
      render: (v: number, record: CacheItem) => {
        if (record.type === 'string') {
          return v > 1024 ? `${(v / 1024).toFixed(1)} KB` : `${v} B`;
        }
        return `${v} 项`;
      },
    },
    {
      title: '值预览',
      dataIndex: 'value',
      ellipsis: true,
      render: (v: string | null) =>
        v ? (
          <Tooltip content={v} style={{ maxWidth: 480 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--semi-color-text-2)' }}>
              {v}
            </span>
          </Tooltip>
        ) : (
          <span style={{ color: 'var(--semi-color-text-3)' }}>—</span>
        ),
    },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 80,
      render: (_: unknown, record: CacheItem) => (
        <Space>
          {hasPermission('system:cache:delete') && (
            <Button
              theme="borderless"
              type="danger"
              size="small"
              onClick={() => handleDelete(record)}
            >
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        left={
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索 Key 名称"
              value={searchInput}
              onChange={setSearchInput}
              onEnterPress={handleSearch}
              style={{ width: 260 }}
              showClear
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
              查询
            </Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>
              重置
            </Button>
          </>
        }
        right={
          <>
            <Button
              type="tertiary"
              icon={<RotateCcw size={14} />}
              onClick={() => void fetchData(keyword)}
            >
              刷新
            </Button>
            {hasPermission('system:cache:delete') && (
              <Button
                type="danger"
                theme="light"
                icon={<Trash2 size={14} />}
                onClick={handleClearAll}
              >
                清空全部
              </Button>
            )}
          </>
        }
      />

      <div style={{ marginBottom: 8, color: 'var(--semi-color-text-2)', fontSize: 13 }}>
        共 <Badge count={data.length} overflowCount={9999} type="primary" style={{ marginInline: 4 }} /> 条缓存
      </div>

      <Table
        bordered
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="key"
        pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOpts: [20, 50, 100] }}
        empty="暂无缓存数据"
        scroll={{ x: 860 }}
      />
    </div>
  );
}
