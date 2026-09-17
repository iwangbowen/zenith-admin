import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Button, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ChevronsUpDown, ChevronsDownUp } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { useListSearch } from '@/hooks/useListSearch';
import { usePinyinReady } from '@/hooks/usePinyinReady';
import { textMatches } from '@/utils/pinyin';
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
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { ListSearchToolbar, listTableProps, useStatusToggle, useCrudOperationColumn } from '@/components/list-page';

const { Text } = Typography;

const PROVIDER_LABELS = new Map(AI_COMMON_PROVIDERS.map((p) => [p.id, p.label]));
const COMMON_ORDER = new Map(AI_COMMON_PROVIDERS.map((p, i) => [p.id, i]));

const EMPTY_PROVIDER_CONFIGS: AiProviderConfig[] = [];

interface SearchParams {
  keyword: string;
}

const defaultSearchParams: SearchParams = { keyword: '' };

export default function AIProvidersPage() {
  const { hasPermission } = usePermission();
  // 全量列表 + 客户端过滤：submittedParams 进过滤谓词，「查询 / 重置」仍回源刷新
  const { bindKeyword, submittedParams, handleSearch, handleReset } = useListSearch<SearchParams>({
    defaults: defaultSearchParams,
    listKey: aiProviderKeys.lists,
  });
  const search = submittedParams.keyword;
  const [editTarget, setEditTarget] = useState<AiProviderConfig | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const listQuery = useAiProviderList();
  const list = listQuery.data ?? EMPTY_PROVIDER_CONFIGS;
  const toggleStatusMutation = useSaveAiProvider();
  const deleteMutation = useDeleteAiProvider();
  const setDefaultMutation = useSetDefaultAiProvider();
  const status = useStatusToggle<AiProviderConfig>({
    isEnabled: (record) => record.isEnabled,
    toggle: (record, enabled) => toggleStatusMutation.mutateAsync({ id: record.id, values: { isEnabled: enabled } }),
    confirmDisable: (record) => ({
      title: '确认禁用',
      content: `禁用后「${record.name}」将无法提供 AI 服务，确认禁用？`,
    }),
    disabled: !hasPermission('ai:provider:edit'),
    messages: { disabled: '已禁用' },
  });

  const openCreate = () => {
    setEditTarget(null);
    setModalVisible(true);
  };

  const openEdit = (record: AiProviderConfig) => {
    setEditTarget(record);
    setModalVisible(true);
  };

  const handleSetDefault = async (id: number) => {
    await setDefaultMutation.mutateAsync({ params: { id } });
    Toast.success('已设为默认');
  };

  // 扁平数据 + 组间排序（常用服务商排前），分组由表格 groupBy 完成
  // 配置名称支持拼音首字母 / 全拼；拼音词典就绪后重算，pinyinReady 仅作为重算信号
  const pinyinReady = usePinyinReady();
  const flatData = useMemo<AiProviderConfig[]>(() => {
    const filtered = list.filter(
      (item) =>
        textMatches(item.name, search) ||
        (item.models ?? []).some((m) => textMatches(m, search)),
    );
    return [...filtered].sort(
      (a, b) =>
        (COMMON_ORDER.get(a.providerId) ?? 999) - (COMMON_ORDER.get(b.providerId) ?? 999)
        || a.providerId.localeCompare(b.providerId),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, search, pinyinReady]);

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

  const operationColumn = useCrudOperationColumn<AiProviderConfig>({
    permissions: { edit: 'ai:provider:edit', remove: 'ai:provider:delete' },
    edit: openEdit,
    remove: (record) => deleteMutation.mutateAsync({ params: { id: record.id } }),
    title: '确定要删除该服务商配置吗？',
    extraBetween: (record) => [
      {
        key: 'set-default',
        label: '设为默认',
        hidden: !hasPermission('ai:provider:edit') || record.isDefault,
        onClick: () => handleSetDefault(record.id),
      },
    ],
    width: 180,
    desktopInlineKeys: ['edit', 'delete'],
  });

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
    status.column({ dataIndex: 'isEnabled' }),
    operationColumn,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索名称/模型" {...bindKeyword('keyword')} />}
        onSearch={handleSearch}
        onReset={handleReset}
        create={<CreateButton permission="ai:provider:create" onClick={openCreate} />}
        actions={(
          <Button
            type="primary"
            icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            onClick={toggleExpandAll}
          >
            {isAllExpanded ? '全部折叠' : '全部展开'}
          </Button>
        )}
        actionTitle="表格操作"
      />
      {/* 数据源是客户端过滤 / 排序后的结果，覆盖 listTableProps 接好的 dataSource；分组表格不分页 */}
      <ConfigurableTable
        columns={columns}
        {...listTableProps(listQuery)}
        dataSource={flatData}
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
