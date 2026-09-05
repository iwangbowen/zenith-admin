import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Button, Modal, Tag, Toast, Switch, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ChevronsUpDown, ChevronsDownUp } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePermission } from '@/hooks/usePermission';
import { useTreeExpansion, type TreeRowKey } from '@/hooks/useTreeExpansion';
import type { AiProviderConfig } from '@zenith/shared/ai';
import { AI_COMMON_PROVIDERS } from '@zenith/shared/ai';
import AiProviderFormModal from '../components/AiProviderFormModal';
import {
  aiProviderKeys,
  useAiProviderList,
  useDeleteAiProvider,
  useSaveAiProvider,
  useSetDefaultAiProvider,
} from '@/hooks/queries/ai-providers';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';

const { Text } = Typography;

const PROVIDER_LABELS = new Map(AI_COMMON_PROVIDERS.map((p) => [p.id, p.label]));
const COMMON_ORDER = new Map(AI_COMMON_PROVIDERS.map((p, i) => [p.id, i]));

const EMPTY_PROVIDER_CONFIGS: AiProviderConfig[] = [];

export default function AIProvidersPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editTarget, setEditTarget] = useState<AiProviderConfig | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const listQuery = useAiProviderList();
  const list = listQuery.data ?? EMPTY_PROVIDER_CONFIGS;
  const toggleStatusMutation = useSaveAiProvider();
  const deleteMutation = useDeleteAiProvider();
  const setDefaultMutation = useSetDefaultAiProvider();
  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  const handleToggleStatus = (record: AiProviderConfig, checked: boolean) => {
    const doToggle = async () => {
      await toggleStatusMutation.mutateAsync({ id: record.id, values: { isEnabled: checked } });
      Toast.success(checked ? '已启用' : '已禁用');
    };
    if (checked) {
      void doToggle();
    } else {
      Modal.confirm({
        title: '确认禁用',
        content: `禁用后「${record.name}」将无法提供 AI 服务，确认禁用？`,
        onOk: () => void doToggle(),
      });
    }
  };

  function handleSearch() {
    void queryClient.invalidateQueries({ queryKey: aiProviderKeys.lists });
  }

  function handleReset() {
    setSearch('');
    void queryClient.invalidateQueries({ queryKey: aiProviderKeys.lists });
  }

  const openCreate = () => {
    setEditTarget(null);
    setModalVisible(true);
  };

  const openEdit = (record: AiProviderConfig) => {
    setEditTarget(record);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync({ params: { id } });
    Toast.success('删除成功');
  };

  const handleSetDefault = async (id: number) => {
    await setDefaultMutation.mutateAsync({ params: { id } });
    Toast.success('已设为默认');
  };

  // 扁平数据 + 组间排序（常用服务商排前），分组由表格 groupBy 完成
  const flatData = useMemo<AiProviderConfig[]>(() => {
    const filtered = list.filter(
      (item) =>
        !search ||
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        (item.models ?? []).some((m) => m.toLowerCase().includes(search.toLowerCase())),
    );
    return [...filtered].sort(
      (a, b) =>
        (COMMON_ORDER.get(a.providerId) ?? 999) - (COMMON_ORDER.get(b.providerId) ?? 999)
        || a.providerId.localeCompare(b.providerId),
    );
  }, [list, search]);

  // providerId → 配置数（组头计数）
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of flatData) counts.set(item.providerId, (counts.get(item.providerId) ?? 0) + 1);
    return counts;
  }, [flatData]);

  const {
    expandedRowKeys, allRowKeys: allGroupKeys,
    isAllExpanded, toggleExpandAll, setExpandedRowKeys, onExpandedRowsChange,
  } = useTreeExpansion(flatData, {
    // 展开态的 key 是组 key（providerId）；onExpandedRowsChange 回传 { groupKey } 行
    collectKeys: (rows) => [...new Set(rows.map((row) => row.providerId))],
    getRowKey: (row) => (row && typeof row === 'object' && 'groupKey' in row
      ? (row as { groupKey: TreeRowKey }).groupKey
      : undefined),
  });

  // 首次出现的分组自动展开（含首次加载全展开）；已见过的分组保持用户展开/折叠状态，
  // 避免数据刷新或 keepAlive 页签切回（effect 重放）时把用户手动折叠的分组弹回展开
  const seenGroupKeysRef = useRef<Set<TreeRowKey>>(new Set());
  useEffect(() => {
    const newKeys = allGroupKeys.filter((k) => !seenGroupKeysRef.current.has(k));
    if (newKeys.length === 0) return;
    newKeys.forEach((k) => seenGroupKeysRef.current.add(k));
    setExpandedRowKeys((prev) => [...prev, ...newKeys]);
  }, [allGroupKeys, setExpandedRowKeys]);

  const columns: ColumnProps<AiProviderConfig>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      minWidth: 320,
    },
    {
      title: '模型',
      dataIndex: 'defaultModel',
      width: 220,
      render: (_: unknown, record: AiProviderConfig) => {
        const extra = (record.models ?? []).length - 1;
        return extra > 0 ? `${record.defaultModel} 等 ${extra + 1} 个` : record.defaultModel;
      },
    },
    {
      title: '默认',
      dataIndex: 'isDefault',
      width: 80,
      render: (_: unknown, record: AiProviderConfig) =>
        (record.isDefault ? <Tag color="blue" size="small">默认</Tag> : null),
    },
    {
      title: '状态',
      dataIndex: 'isEnabled',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, record: AiProviderConfig) => (
        <Switch
          checked={record.isEnabled}
          loading={togglingStatusId === record.id}
          disabled={!hasPermission('ai:provider:edit')}
          onChange={(checked) => handleToggleStatus(record, checked)}
          size="small"
        />
      ),
    },
    createOperationColumn<AiProviderConfig>({
      width: 180,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('ai:provider:edit'),
          onClick: () => openEdit(record),
        },
        {
          key: 'set-default',
          label: '设为默认',
          hidden: !hasPermission('ai:provider:edit') || record.isDefault,
          onClick: () => handleSetDefault(record.id),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('ai:provider:delete'),
          onClick: () => {
            confirmDelete({
              title: '确定要删除该服务商配置吗？',
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="搜索名称/模型" value={search} onChange={(v) => setSearch(String(v ?? ''))} onSearch={handleSearch} />
  );

  const renderSearchButton = () => (
    <SearchButton onClick={handleSearch} />
  );

  const renderResetButton = () => (
    <ResetButton onClick={handleReset} />
  );

  const renderExpandButton = () => (
    <Button
      type="primary"
      icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
      onClick={toggleExpandAll}
    >
      {isAllExpanded ? '全部折叠' : '全部展开'}
    </Button>
  );

  const renderCreateButton = () => hasPermission('ai:provider:create') ? (
    <CreateButton onClick={openCreate} />
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        actions={(
          <>
            {renderExpandButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileActions={renderExpandButton()}
        actionTitle="表格操作"
      />
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={flatData}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="id"
        pagination={false}
        groupBy={(record?: AiProviderConfig) => record?.providerId ?? ''}
        clickGroupedRowToExpand
        renderGroupSection={(groupKey) => {
          const providerId = String(groupKey);
          return (
            <>
              <strong>{PROVIDER_LABELS.get(providerId) ?? providerId}</strong>
              <Text type="tertiary" size="small" style={{ marginLeft: 8 }}>
                {groupCounts.get(providerId) ?? 0} 个配置
              </Text>
            </>
          );
        }}
        expandedRowKeys={expandedRowKeys}
        onExpandedRowsChange={onExpandedRowsChange}
      />

      <AiProviderFormModal
        visible={modalVisible}
        editTarget={editTarget}
        onClose={() => { setModalVisible(false); setEditTarget(null); }}
        onSaved={() => { setModalVisible(false); setEditTarget(null); }}
      />
    </div>
  );
}
