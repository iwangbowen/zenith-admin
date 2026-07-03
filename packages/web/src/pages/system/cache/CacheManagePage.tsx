import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppModal } from '@/components/AppModal';
import {
  Badge,
  Button,
  Dropdown,
  Input,
  InputNumber,
  JsonViewer,
  Modal,
  Radio,
  RadioGroup,
  Space,
  Tag,
  TextArea,
  Toast,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { Search, RotateCcw, RefreshCw, Trash2, MoreHorizontal, Pencil, Clock } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListPanel, NavListItem } from '@/components/NavListPanel';
import {
  cacheKeys,
  type CacheItem,
  type CacheOverview,
  useBatchDeleteCacheKeys,
  useCacheValue,
  useCacheList,
  useCacheOverview,
  useClearAllCache,
  useDeleteCacheCategory,
  useDeleteCacheKey,
  useUpdateCacheTtl,
  useUpdateCacheValue,
} from '@/hooks/queries/cache';

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

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}天 ${hours}小时`;
  if (hours > 0) return `${hours}小时 ${minutes}分`;
  return `${minutes}分`;
}

function OverviewStat({ label, value, tone }: Readonly<{ label: string; value: string; tone?: 'normal' | 'success' | 'warning' }>) {
  const color =
    tone === 'success' ? 'var(--semi-color-success)' :
    tone === 'warning' ? 'var(--semi-color-warning)' :
    'var(--semi-color-text-0)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 88 }}>
      <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

export default function CacheManagePage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const { pageSize } = usePagination();
  const canEdit = hasPermission('system:cache:update');
  const canDelete = hasPermission('system:cache:delete');
  const [selectedCategory, setSelectedCategory] = useState<CategoryRow | null>(null);
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [viewingItem, setViewingItem] = useState<CacheItem | null>(null);
  const [fullValue, setFullValue] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [ttlEditItem, setTtlEditItem] = useState<CacheItem | null>(null);
  const [ttlMode, setTtlMode] = useState<'persist' | 'custom'>('custom');
  const [ttlSeconds, setTtlSeconds] = useState<number>(3600);
  const listQuery = useCacheList();
  const overviewQuery = useCacheOverview();
  const valueQuery = useCacheValue(viewingItem?.key, !!viewingItem);
  const data = listQuery.data?.list ?? [];
  const overview: CacheOverview | null = overviewQuery.data ?? null;
  const loading = listQuery.isFetching;
  const overviewLoading = overviewQuery.isFetching;
  const deleteKeyMutation = useDeleteCacheKey();
  const batchDeleteMutation = useBatchDeleteCacheKeys();
  const deleteCategoryMutation = useDeleteCacheCategory();
  const clearAllMutation = useClearAllCache();
  const updateTtlMutation = useUpdateCacheTtl();
  const updateValueMutation = useUpdateCacheValue();
  const savingTtl = updateTtlMutation.isPending;
  const savingValue = updateValueMutation.isPending;

  const openValueModal = async (item: CacheItem) => {
    setViewingItem(item);
    setFullValue(null);
    setEditMode(false);
  };
  const fullValueLoading = valueQuery.isFetching;

  useEffect(() => {
    if (viewingItem) setFullValue(valueQuery.data ?? null);
  }, [viewingItem, valueQuery.data]);

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: cacheKeys.all });
  };

  useEffect(() => {
    setSelectedKeys([]);
  }, [listQuery.data]);

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

  // 切换分类时清空批量选择
  useEffect(() => {
    setSelectedKeys([]);
  }, [selectedCategory?.category]);

  const handleSearch = () => {
    setKeyword(searchInput);
    void queryClient.invalidateQueries({ queryKey: cacheKeys.lists });
  };

  const handleReset = () => {
    setSearchInput('');
    setKeyword('');
    void queryClient.invalidateQueries({ queryKey: cacheKeys.lists });
  };

  const handleDeleteKey = (item: CacheItem) => {
    Modal.confirm({
      title: '确定要删除该缓存键吗？',
      content: <span>Key：<code>{item.displayKey}</code></span>,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteKeyMutation.mutateAsync(item.key);
        Toast.success('删除成功');
      },
    });
  };

  const handleBatchDelete = () => {
    if (selectedKeys.length === 0) return;
    Modal.confirm({
      title: `确定要删除选中的 ${selectedKeys.length} 个缓存键吗？`,
      content: '操作不可撤销，请谨慎。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await batchDeleteMutation.mutateAsync(selectedKeys);
        Toast.success(`已删除 ${res.count ?? 0} 条缓存`);
      },
    });
  };

  const handleDeleteCategory = (row: CategoryRow) => {
    Modal.confirm({
      title: `确定要删除「${row.category}」分类下的所有缓存吗？`,
      content: `共 ${row.count} 条缓存将被删除，操作不可撤销。`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await deleteCategoryMutation.mutateAsync(row.segment);
        Toast.success(`已删除 ${res.count ?? 0} 条缓存`);
        if (selectedCategory?.category === row.category) {
          setSelectedCategory(null);
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
        const res = await clearAllMutation.mutateAsync();
        Toast.success(`已清空 ${res.count ?? 0} 条缓存`);
        setSelectedCategory(null);
      },
    });
  };

  const openTtlEdit = (item: CacheItem) => {
    setTtlEditItem(item);
    if (item.ttl === -1) {
      setTtlMode('persist');
      setTtlSeconds(3600);
    } else {
      setTtlMode('custom');
      setTtlSeconds(item.ttl > 0 ? item.ttl : 3600);
    }
  };

  const handleSaveTtl = async () => {
    if (!ttlEditItem) return;
    const ttl = ttlMode === 'persist' ? -1 : ttlSeconds;
    if (ttlMode === 'custom' && (!Number.isInteger(ttl) || ttl <= 0)) {
      Toast.warning('请输入大于 0 的秒数');
      return;
    }
    await updateTtlMutation.mutateAsync({ key: ttlEditItem.key, ttl });
    Toast.success('修改成功');
    setTtlEditItem(null);
  };

  const startEditValue = () => {
    setEditValue(fullValue ?? viewingItem?.value ?? '');
    setEditMode(true);
  };

  const handleSaveValue = async () => {
    if (!viewingItem) return;
    await updateValueMutation.mutateAsync({ key: viewingItem.key, value: editValue });
    Toast.success('修改成功');
    setFullValue(editValue);
    setEditMode(false);
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
    createOperationColumn<CacheItem>({
      width: 200,
      actions: (record) => [
        {
          key: 'view',
          label: '查看',
          hidden: record.value == null,
          onClick: () => { void openValueModal(record); },
        },
        {
          key: 'ttl',
          label: 'TTL',
          hidden: !canEdit,
          onClick: () => openTtlEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !canDelete,
          onClick: () => handleDeleteKey(record),
        },
      ],
    }),
  ];

  const cacheMaster = (
    <NavListPanel
      title="缓存分类"
      loading={loading}
      emptyText="暂无缓存分类"
      headerExtra={
        <Dropdown
          trigger="click"
          position="bottomRight"
          clickToHide
          render={
            <Dropdown.Menu>
              <Dropdown.Item onClick={refreshAll}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <RefreshCw size={14} /> 刷新
                </span>
              </Dropdown.Item>
              {canDelete && (
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
      }
      dataSource={categoryRows}
      renderItem={(row) => (
        <NavListItem
          key={row.category}
          active={selectedCategory?.category === row.category}
          onClick={() => setSelectedCategory(row)}
          icon={
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
              background: `var(--semi-color-${CATEGORY_COLORS[row.category] ?? 'grey'}-5, var(--semi-color-primary))`,
            }} />
          }
          primary={row.category}
          secondary={
            <Badge count={row.count} overflowCount={9999} type="primary" />
          }
          extraAlwaysVisible
          extra={
            canDelete ? (
              <Button
                theme="borderless"
                type="danger"
                size="small"
                onClick={(e) => { e.stopPropagation(); handleDeleteCategory(row); }}
              >
                删除
              </Button>
            ) : undefined
          }
        />
      )}
    />
  );

  const cacheDetail = (
    <>
      <MasterDetailLayout.Header>
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
      </MasterDetailLayout.Header>
      <MasterDetailLayout.Body>
        {selectedCategory ? (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
              {canDelete && selectedKeys.length > 0 && (
                <Button type="danger" theme="solid" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
                  批量删除 ({selectedKeys.length})
                </Button>
              )}
            </div>
            <ConfigurableTable<CacheItem>
              bordered
              size="small"
              columns={keyColumns}
              dataSource={displayedItems}
              loading={loading}
              onRefresh={refreshAll}
              refreshLoading={loading}
              rowKey="key"
              rowSelection={canDelete ? {
                selectedRowKeys: selectedKeys,
                onChange: (keys?: (string | number)[]) => setSelectedKeys((keys ?? []).map(String)),
              } : undefined}
              pagination={{ pageSize }}
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
      </MasterDetailLayout.Body>
    </>
  );

  return (
    <div className="page-container">
      {overview && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 22, padding: '10px 16px', flexWrap: 'wrap',
            background: 'var(--semi-color-bg-1)', border: '1px solid var(--semi-color-border)', borderRadius: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 132 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
              background: overview.connected ? 'var(--semi-color-success)' : 'var(--semi-color-danger)',
            }} />
            <Typography.Text strong>Redis</Typography.Text>
            <Tag color={overview.connected ? 'green' : 'red'} size="small">
              {overview.connected ? '已连接' : '未连接'}
            </Tag>
            {overview.version && (
              <Typography.Text type="tertiary" size="small">v{overview.version}</Typography.Text>
            )}
          </div>
          <OverviewStat label="命名空间 Key" value={String(data.length)} />
          <OverviewStat label="Redis 总 Key" value={String(overview.totalKeys)} />
          <OverviewStat label="内存占用" value={overview.usedMemoryHuman || `${overview.usedMemory} B`} />
          <OverviewStat
            label="命中率"
            value={`${overview.hitRate}%`}
            tone={overview.hitRate >= 90 ? 'success' : overview.hitRate < 70 ? 'warning' : 'normal'}
          />
          <OverviewStat label="客户端连接" value={String(overview.connectedClients)} />
          <OverviewStat label="运行时长" value={formatUptime(overview.uptimeSeconds)} />
          <OverviewStat
            label="内存碎片率"
            value={overview.memFragmentationRatio ? overview.memFragmentationRatio.toFixed(2) : '—'}
            tone={overview.memFragmentationRatio > 1.5 ? 'warning' : 'normal'}
          />
          <Button
            type="tertiary"
            theme="borderless"
            style={{ marginLeft: 'auto' }}
            icon={<RefreshCw size={14} className={overviewLoading ? 'spin' : ''} />}
            aria-label="刷新概览"
            title="刷新概览"
            disabled={overviewLoading}
            onClick={() => void overviewQuery.refetch()}
          />
        </div>
      )}

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

      <AppModal
        title={
          <span>
            {editMode ? '编辑缓存值' : '查看缓存值'}
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
        onCancel={() => { setViewingItem(null); setFullValue(null); setEditMode(false); }}
        footer={
          viewingItem && canEdit && viewingItem.type === 'string' ? (
            editMode ? (
              <Space>
                <Button onClick={() => setEditMode(false)}>取消</Button>
                <Button type="primary" theme="solid" loading={savingValue} onClick={() => void handleSaveValue()}>
                  保存
                </Button>
              </Space>
            ) : (
              <Button
                icon={<Pencil size={14} />}
                onClick={startEditValue}
                disabled={fullValueLoading}
              >
                编辑
              </Button>
            )
          ) : null
        }
        width={680}
      >
        {viewingItem && !editMode && (
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
        {viewingItem && editMode && (
          <TextArea
            value={editValue}
            onChange={setEditValue}
            autosize={{ minRows: 12, maxRows: 18 }}
            style={{ fontFamily: 'monospace', fontSize: 13 }}
            placeholder="请输入缓存值（字符串）"
          />
        )}
        {fullValueLoading && (
          <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--semi-color-text-2)', fontSize: 13 }}>
            加载完整内容中…
          </div>
        )}
      </AppModal>

      <AppModal
        title={
          <span>
            修改过期时间
            {ttlEditItem && (
              <Typography.Text
                type="secondary"
                size="small"
                style={{ marginLeft: 8, fontWeight: 'normal', fontFamily: 'monospace' }}
              >
                {ttlEditItem.displayKey}
              </Typography.Text>
            )}
          </span>
        }
        visible={ttlEditItem != null}
        onCancel={() => setTtlEditItem(null)}
        onOk={() => void handleSaveTtl()}
        okButtonProps={{ loading: savingTtl }}
        width={460}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
          <RadioGroup value={ttlMode} onChange={(e) => setTtlMode(e.target.value as 'persist' | 'custom')}>
            <Radio value="custom">设置秒数</Radio>
            <Radio value="persist">永久（不过期）</Radio>
          </RadioGroup>
          {ttlMode === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={14} style={{ color: 'var(--semi-color-text-2)' }} />
              <InputNumber
                min={1}
                step={60}
                value={ttlSeconds}
                onChange={(v) => setTtlSeconds(typeof v === 'number' ? v : Number(v) || 0)}
                style={{ width: 200 }}
                suffix="秒"
              />
              <Typography.Text type="tertiary" size="small">
                ≈ {formatUptime(ttlSeconds)}
              </Typography.Text>
            </div>
          )}
        </div>
      </AppModal>
    </div>
  );
}
