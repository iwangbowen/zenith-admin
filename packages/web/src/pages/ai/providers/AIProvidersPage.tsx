import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Input, Modal, Popconfirm, Space, Tag, Toast, Switch } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search, ChevronsUpDown, ChevronsDownUp } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import type { AiProvider, AiProviderConfig } from '@zenith/shared';
import AiProviderFormModal from '../components/AiProviderFormModal';

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

export default function AIProvidersPage() {
  const { hasPermission } = usePermission();
  const [list, setList] = useState<AiProviderConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const [editTarget, setEditTarget] = useState<AiProviderConfig | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());

  const handleToggleStatus = (record: AiProviderConfig, checked: boolean) => {
    const doToggle = async () => {
      setTogglingIds((prev) => new Set(prev).add(record.id));
      try {
        await request.put(`/api/ai/providers/${record.id}`, { isEnabled: checked });
        Toast.success(checked ? '已启用' : '已禁用');
        void loadData();
      } catch (err: unknown) {
        Toast.error((err as { message?: string })?.message || '操作失败');
      } finally {
        setTogglingIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; });
      }
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

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<AiProviderConfig[]>('/api/ai/providers');
      setList(res.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openCreate = () => {
    setEditTarget(null);
    setModalVisible(true);
  };

  const openEdit = (record: AiProviderConfig) => {
    setEditTarget(record);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    await request.delete(`/api/ai/providers/${id}`);
    Toast.success('删除成功');
    void loadData();
  };

  const handleSetDefault = async (id: number) => {
    await request.post(`/api/ai/providers/${id}/set-default`, {});
    Toast.success('已设为默认');
    void loadData();
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

  useEffect(() => {
    setExpandedRowKeys(allGroupKeys);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGroupKeys.join(',')]);

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
            loading={togglingIds.has(record.id)}
            disabled={!hasPermission('ai:provider:edit')}
            onChange={(checked) => handleToggleStatus(record, checked)}
            size="small"
          />
        );
      },
    },
    {
      title: '操作',
      dataIndex: 'id',
      width: 250,
      fixed: 'right',
      render: (_: unknown, record: TableRow) => {
        if ('_isGroup' in record) return null;
        return (
          <Space>
            {hasPermission('ai:provider:edit') && (
              <Button theme="borderless" size="small" onClick={() => openEdit(record)}>
                编辑
              </Button>
            )}
            {hasPermission('ai:provider:edit') && !record.isDefault && (
              <Button theme="borderless" size="small" onClick={() => void handleSetDefault(record.id)}>
                设为默认
              </Button>
            )}
            {hasPermission('ai:provider:delete') && (
              <Popconfirm title="确定要删除该服务商配置吗？" onConfirm={() => void handleDelete(record.id)}>
                <Button theme="borderless" type="danger" size="small">
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  const renderKeywordSearch = () => (
    <Input
      placeholder="搜索名称/模型"
      prefix={<Search size={14} />}
      showClear
      value={search}
      onChange={(v) => setSearch(String(v ?? ''))}
      onEnterPress={() => void loadData()}
      style={{ width: 220 }}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={() => void loadData()}>
      查询
    </Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setSearch(''); void loadData(); }}>
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
        loading={loading}
        onRefresh={loadData}
        refreshLoading={loading}
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
        onSaved={() => { setModalVisible(false); setEditTarget(null); void loadData(); }}
      />
    </div>
  );
}
