import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Input,
  Modal,
  Table,
  Tag,
  Toast,
  Tooltip,
} from '@douyinfe/semi-ui';
import { Search, RotateCcw, RefreshCw, Trash2 } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';

interface CacheItem {
  key: string;
  displayKey: string;
  segment: string;
  category: string;
  type: string;
  ttl: number;
  size: number;
  value: string | null;
}

interface CategoryRow {
  category: string;
  segment: string;
  count: number;
}

const TYPE_COLORS: Record<string, 'blue' | 'green' | 'orange' | 'purple' | 'cyan'> = {
  string: 'blue',
  list: 'green',
  hash: 'orange',
  set: 'purple',
  zset: 'cyan',
};

const CATEGORY_COLORS: Record<string, 'amber' | 'blue' | 'green' | 'red' | 'orange' | 'teal'> = {
  '会话 Token': 'blue',
  '强制下线黑名单': 'red',
  '权限缓存': 'teal',
  '登录失败计数': 'orange',
  '登录锁定': 'amber',
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
  const [selectedCategory, setSelectedCategory] = useState<CategoryRow | null>(null);
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<{ list: CacheItem[]; total: number }>('/api/cache');
      if (res.code === 0) {
        setData(res.data.list);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // 按分类聚合，动态生成左侧表格
  const categoryRows: CategoryRow[] = (() => {
    const map = new Map<string, CategoryRow>();
    data.forEach((item) => {
      const existing = map.get(item.category);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(item.category, { category: item.category, segment: item.segment, count: 1 });
      }
    });
    return [...map.values()].sort((a, b) => a.category.localeCompare(b.category));
  })();

  // 右侧：当前选中分类的 key 列表，再按关键词过滤
  const displayedItems = data.filter((item) => {
    const matchCategory = selectedCategory ? item.category === selectedCategory.category : false;
    const matchKeyword = keyword ? item.displayKey.includes(keyword) : true;
    return matchCategory && matchKeyword;
  });

  const handleSearch = () => {
    setKeyword(searchInput);
  };

  const handleReset = () => {
    setSearchInput('');
    setKeyword('');
  };

  const handleDeleteKey = (item: CacheItem) => {
    Modal.confirm({
      title: '确定要删除该缓存键吗？',
      content: <span>Key：<code>{item.displayKey}</code></span>,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete<null>('/api/cache', { key: item.key });
        if (res.code === 0) {
          Toast.success('删除成功');
          void fetchData();
        }
      },
    });
  };

  const handleDeleteCategory = (row: CategoryRow) => {
    Modal.confirm({
      title: `确定要删除「${row.category}」分类下的所有缓存吗？`,
      content: `共 ${row.count} 条缓存将被删除，操作不可撤销。`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete<{ count: number }>('/api/cache/by-category', { segment: row.segment });
        if (res.code === 0) {
          Toast.success(`已删除 ${res.data?.count ?? 0} 条缓存`);
          // 若选中的分类被删除，则清除选中状态
          if (selectedCategory?.category === row.category) {
            setSelectedCategory(null);
          }
          void fetchData();
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
          setSelectedCategory(null);
          void fetchData();
        }
      },
    });
  };

  const categoryColumns: ColumnProps<CategoryRow>[] = [
    {
      title: '分类',
      dataIndex: 'category',
      render: (v: string) => (
        <Tag color={CATEGORY_COLORS[v] ?? 'grey'} size="small" style={{ whiteSpace: 'nowrap' }}>
          {v}
        </Tag>
      ),
    },
    {
      title: '键数',
      dataIndex: 'count',
      width: 60,
      render: (v: number) => (
        <Badge count={v} overflowCount={9999} type="primary" />
      ),
    },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 68,
      render: (_: unknown, record: CategoryRow) =>
        hasPermission('system:cache:delete') ? (
          <Button
            theme="borderless"
            type="danger"
            size="small"
            onClick={(e) => { e.stopPropagation(); handleDeleteCategory(record); }}
          >
            删除
          </Button>
        ) : null,
    },
  ];

  const keyColumns: ColumnProps<CacheItem>[] = [
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
      width: 80,
      render: (v: string) => (
        <Tag color={TYPE_COLORS[v] ?? 'grey'} size="small">{v}</Tag>
      ),
    },
    {
      title: '剩余 TTL',
      dataIndex: 'ttl',
      width: 110,
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
      width: 68,
      render: (_: unknown, record: CacheItem) =>
        hasPermission('system:cache:delete') ? (
          <Button
            theme="borderless"
            type="danger"
            size="small"
            onClick={() => handleDeleteKey(record)}
          >
            删除
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="page-container">
      {/* 顶部工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <Button
          icon={<RefreshCw size={14} />}
          type="tertiary"
          loading={loading}
          onClick={() => void fetchData()}
        >
          刷新
        </Button>
        {hasPermission('system:cache:delete') && (
          <Button
            icon={<Trash2 size={14} />}
            type="danger"
            theme="light"
            onClick={handleClearAll}
          >
            清空全部
          </Button>
        )}
      </div>

      {/* 双列主从布局 */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* 左侧：分类列表 */}
        <div style={{ width: 280, flexShrink: 0 }}>
          <Table<CategoryRow>
            bordered
            size="small"
            columns={categoryColumns}
            dataSource={categoryRows}
            loading={loading}
            rowKey="category"
            pagination={false}
            empty="暂无缓存分类"
            onRow={(record) => ({
              onClick: () => setSelectedCategory(record ?? null),
              style: {
                cursor: 'pointer',
                background:
                    record?.category === selectedCategory?.category
                    ? 'var(--semi-color-primary-light-default)'
                    : undefined,
              },
            })}
          />
        </div>

        {/* 右侧：键列表 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedCategory ? (
            <>
              {/* 右侧搜索栏 */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <Input
                  prefix={<Search size={14} />}
                  placeholder="搜索 Key 名称"
                  value={searchInput}
                  onChange={setSearchInput}
                  onEnterPress={handleSearch}
                  style={{ width: 260 }}
                  showClear
                />
                <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
                <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
                <span style={{ marginLeft: 'auto', lineHeight: '32px', color: 'var(--semi-color-text-2)', fontSize: 13 }}>
                  {selectedCategory.category}
                  <Badge
                    count={displayedItems.length}
                    overflowCount={9999}
                    type="primary"
                    style={{ marginLeft: 6 }}
                  />
                </span>
              </div>
              <Table<CacheItem>
                bordered
                size="small"
                columns={keyColumns}
                dataSource={displayedItems}
                loading={loading}
                rowKey="key"
                pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOpts: [20, 50, 100] }}
                empty="该分类暂无缓存数据"
                scroll={{ x: 820 }}
              />
            </>
          ) : (
            <div
              style={{
                height: 200,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--semi-color-text-2)',
                fontSize: 14,
                border: '1px dashed var(--semi-color-border)',
                borderRadius: 4,
              }}
            >
              请点击左侧分类查看对应的缓存键
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
