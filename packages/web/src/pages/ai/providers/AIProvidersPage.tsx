import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Button, Input, Modal, Tag, Toast, Switch } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search, ChevronsUpDown, ChevronsDownUp } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePermission } from '@/hooks/usePermission';
import type { AiProvider, AiProviderConfig } from '@zenith/shared';
import AiProviderFormModal from '../components/AiProviderFormModal';
import {
  aiProviderKeys,
  useAiProviderList,
  useDeleteAiProvider,
  useSaveAiProvider,
  useSetDefaultAiProvider,
} from '@/hooks/queries/ai-providers';

const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai_compatible: 'OpenAI Compatible',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  baidu: '百度千帆',
};

const PROVIDER_ORDER: AiProvider[] = ['openai_compatible', 'anthropic', 'gemini', 'baidu'];

type AiProviderConfigWithKey = AiProviderConfig & { key: string };

interface ProviderGroupRow {
  _isGroup: true;
  key: string;
  provider: AiProvider;
  name: string;
  count: number;
  children: AiProviderConfigWithKey[];
}

type TableRow = ProviderGroupRow | AiProviderConfigWithKey;
const EMPTY_PROVIDER_CONFIGS: AiProviderConfig[] = [];

export default function AIProvidersPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const [editTarget, setEditTarget] = useState<AiProviderConfig | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const listQuery = useAiProviderList({});
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
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  };

  const handleSetDefault = async (id: number) => {
    await setDefaultMutation.mutateAsync(id);
    Toast.success('已设为默认');
  };

  // 按供应商类型聚合为树形数据
  const treeData = useMemo<ProviderGroupRow[]>(() => {
    const filtered = list.filter(
      (item) =>
        !search ||
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        item.model.toLowerCase().includes(search.toLowerCase()),
    );

    const grouped = new Map<AiProvider, AiProviderConfig[]>();
    for (const item of filtered) {
      const existing = grouped.get(item.provider) ?? [];
      existing.push(item);
      grouped.set(item.provider, existing);
    }

    return PROVIDER_ORDER.filter((provider) => grouped.has(provider)).map((provider) => {
      const children = grouped.get(provider)!;
      return {
        _isGroup: true as const,
        key: `group_${provider}`,
        provider,
        name: PROVIDER_LABELS[provider] ?? provider,
        count: children.length,
        children: children.map((c) => ({ ...c, key: `config_${c.id}` })),
      };
    });
  }, [list, search]);

  const allGroupKeys = useMemo(() => treeData.map((g) => g.key), [treeData]);

  const isAllExpanded = expandedRowKeys.length > 0 && expandedRowKeys.length >= allGroupKeys.length;

  function toggleExpandAll() {
    setExpandedRowKeys(isAllExpanded ? [] : allGroupKeys);
  }

  // 首次出现的分组自动展开（含首次加载全展开）；已见过的分组保持用户展开/折叠状态，
  // 避免数据刷新或 keepAlive 页签切回（effect 重放）时把用户手动折叠的分组弹回展开
  const seenGroupKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const newKeys = allGroupKeys.filter((k) => !seenGroupKeysRef.current.has(k));
    if (newKeys.length === 0) return;
    newKeys.forEach((k) => seenGroupKeysRef.current.add(k));
    setExpandedRowKeys((prev) => [...prev, ...newKeys]);
  }, [allGroupKeys]);

  const columns: ColumnProps<TableRow>[] = [
    {
      title: '名称 / 供应商',
      dataIndex: 'name',
      render: (_: unknown, record: TableRow) => {
        if ('_isGroup' in record) {
          return <strong>{record.name}</strong>;
        }
        return record.name;
      },
    },
    {
      title: '模型',
      dataIndex: 'model',
      width: 180,
      render: (_: unknown, record: TableRow) => {
        if ('_isGroup' in record) return null;
        return record.model;
      },
    },
    {
      title: '默认',
      dataIndex: 'isDefault',
      width: 80,
      render: (_: unknown, record: TableRow) => {
        if ('_isGroup' in record) return null;
        return record.isDefault ? <Tag color="blue" size="small">默认</Tag> : null;
      },
    },
    {
      title: '状态',
      dataIndex: 'isEnabled',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, record: TableRow) => {
        if ('_isGroup' in record) return null;
        return (
          <Switch
            checked={record.isEnabled}
            loading={togglingStatusId === record.id}
            disabled={!hasPermission('ai:provider:edit')}
            onChange={(checked) => handleToggleStatus(record, checked)}
            size="small"
          />
        );
      },
    },
    createOperationColumn<TableRow>({
      width: 250,
      desktopInlineKeys: ['edit', 'set-default', 'delete'],
      actions: (record) => {
        if ('_isGroup' in record) return [];
        return [
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
              Modal.confirm({
                title: '确定要删除该服务商配置吗？',
                okButtonProps: { type: 'danger', theme: 'solid' },
                onOk: () => handleDelete(record.id),
              });
            },
          },
        ];
      },
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      placeholder="搜索名称/模型"
      prefix={<Search size={14} />}
      showClear
      value={search}
      onChange={(v) => setSearch(String(v ?? ''))}
      onEnterPress={handleSearch}
      style={{ width: 220 }}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
      查询
    </Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>
      重置
    </Button>
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
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>
      新增
    </Button>
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
        dataSource={treeData}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="key"
        pagination={false}
        expandedRowKeys={expandedRowKeys}
        onExpandedRowsChange={(rows) =>
          setExpandedRowKeys((rows ?? []).filter((r): r is ProviderGroupRow => '_isGroup' in r).map((r) => r.key))
        }
        expandRowByClick
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
