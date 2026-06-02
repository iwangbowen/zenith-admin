import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Dropdown,
  Input,
  JsonViewer,
  Modal,
  Space,
  Tag,
  Toast,
  Tooltip,
  Typography,
  List as SemiList,
} from '@douyinfe/semi-ui';
import { Search, RotateCcw, RefreshCw, Trash2, MoreHorizontal } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import ConfigurableTable from '@/components/ConfigurableTable';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import './CacheManagePage.css';

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
  const [viewingItem, setViewingItem] = useState<CacheItem | null>(null);
  const [fullValue, setFullValue] = useState<string | null>(null);
  const [fullValueLoading, setFullValueLoading] = useState(false);

  const openValueModal = async (item: CacheItem) => {
    setViewingItem(item);
    setFullValue(null);
    setFullValueLoading(true);
    try {
      const res = await request.get<string | null>(`/api/cache/value?key=${encodeURIComponent(item.key)}`);
      if (res.code === 0) setFullValue(res.data);
    } finally {
      setFullValueLoading(false);
    }
  };

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

  // 按分类聚合
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

  // 默认选中第一个分类
  useEffect(() => {
    if (!loading && data.length > 0) {
      setSelectedCategory((prev) => {
        if (prev) {
          const stillExists = categoryRows.find((r) => r.category === prev.category);
          if (stillExists) return stillExists;
        }
        return categoryRows.length > 0 ? categoryRows[0] : null;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, data.length]);

  // 右侧：当前选中分类的 key 列表，再按关键词过滤
  const displayedItems = data.filter((item) => {
    const matchCategory = selectedCategory ? item.category === selectedCategory.category : false;
    const matchKeyword = keyword ? item.displayKey.includes(keyword) : true;
    return matchCategory && matchKeyword;
  });

  const handleSearch = () => {
    setKeyword(searchInput);
    void fetchData();
  };

  const handleReset = () => {
    setSearchInput('');
    setKeyword('');
    void fetchData();
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
      width: 150,
      render: (_: unknown, record: CacheItem) => (
        <Space>
          {record.value != null && (
            <Button
              theme="borderless"
              size="small"
              onClick={() => void openValueModal(record)}
            >
              查看
            </Button>
          )}
          {hasPermission('system:cache:delete') && (
            <Button
              theme="borderless"
              type="danger"
              size="small"
              onClick={() => handleDeleteKey(record)}
            >
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const cacheMaster = (
    <div className="cache-master">
      <div className="cache-master-header">
        <span className="cache-master-title">缓存分类</span>
        <Dropdown
          trigger="click"
          position="bottomRight"
          clickToHide
          render={
            <Dropdown.Menu>
              <Dropdown.Item onClick={() => void fetchData()}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <RefreshCw size={14} /> 刷新
                </span>
              </Dropdown.Item>
              {hasPermission('system:cache:delete') && (
                <Dropdown.Item type="danger" onClick={handleClearAll}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Trash2 size={14} /> 清空全部
                  </span>
                </Dropdown.Item>
              )}
            </Dropdown.Menu>
          }
        >
          <Button theme="borderless" size="small" icon={<MoreHorizontal size={14} />} />
        </Dropdown>
      </div>
      <div className="cache-master-list">
        <SemiList<CategoryRow>
          className="cache-list"
          size="small"
          split={false}
          loading={loading}
          dataSource={categoryRows}
          emptyContent={<div className="cache-empty">暂无缓存分类</div>}
          renderItem={(row) => (
            <SemiList.Item
              key={row.category}
              className={`cache-list-item${selectedCategory?.category === row.category ? ' cache-list-item--active' : ''}`}
              onClick={() => setSelectedCategory(row)}
              main={
                <div className="cache-list-item-main">
                  <div className="cache-list-item-title">
                    <Tag color={CATEGORY_COLORS[row.category] ?? 'grey'} size="small" style={{ whiteSpace: 'nowrap' }}>
                      {row.category}
                    </Tag>
                  </div>
                  <Badge count={row.count} overflowCount={9999} type="primary" />
                </div>
              }
              extra={
                hasPermission('system:cache:delete') ? (
                  <Button
                    theme="borderless"
                    type="danger"
                    size="small"
                    onClick={(e) => { e.stopPropagation(); handleDeleteCategory(row); }}
                  >
                    删除
                  </Button>
                ) : null
              }
            />
          )}
        />
      </div>
    </div>
  );

  const cacheDetail = (
    <div className="cache-detail">
      <div className="cache-detail-header">
        {selectedCategory ? (
          <>
            <Tag color={CATEGORY_COLORS[selectedCategory.category] ?? 'grey'} size="small" style={{ whiteSpace: 'nowrap' }}>
              {selectedCategory.category}
            </Tag>
            <Badge count={displayedItems.length} overflowCount={9999} type="primary" />
          </>
        ) : (
          <span className="cache-detail-placeholder">请选择缓存分类</span>
        )}
      </div>
      <div className="cache-detail-body">
        {selectedCategory ? (
          <>
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
                共 {displayedItems.length} 条
              </span>
            </div>
            <ConfigurableTable<CacheItem>
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
  );

  return (
    <div className="page-container">
      <MasterDetailLayout
        master={cacheMaster}
        detail={cacheDetail}
        defaultSize={300}
        minSize={260}
        maxSize={420}
        persistKey="cache"
        showDetail={!!selectedCategory}
        onBack={() => setSelectedCategory(null)}
        style={{ flex: 1, overflow: 'hidden' }}
      />

      <Modal
        title={
          <span>
            查看缓存值
            {viewingItem && (
              <Typography.Text
                type="secondary"
                size="small"
                style={{ marginLeft: 8, fontWeight: 'normal', fontFamily: 'monospace' }}
              >
                {viewingItem.displayKey}
              </Typography.Text>
            )}
          </span>
        }
        visible={viewingItem != null}
        onCancel={() => { setViewingItem(null); setFullValue(null); }}
        footer={null}
        width={680}
      >
        {viewingItem && (
          <JsonViewer
            key={viewingItem.key}
            value={(() => {
              const raw = fullValue ?? viewingItem.value;
              if (!raw) return '';
              try { return JSON.stringify(JSON.parse(raw), null, 2); }
              catch { return raw; }
            })()}
            height={360}
            width="100%"
            options={{ readOnly: true, autoWrap: true, formatOptions: { tabSize: 2, insertSpaces: true } }}
          />
        )}
        {fullValueLoading && (
          <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--semi-color-text-2)', fontSize: 13 }}>
            加载完整内容中…
          </div>
        )}
      </Modal>
    </div>
  );
}
