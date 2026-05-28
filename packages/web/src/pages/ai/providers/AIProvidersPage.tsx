import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, Popconfirm, Space, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import type { AiProvider, AiProviderConfig } from '@zenith/shared';
import AiProviderFormModal from '../components/AiProviderFormModal';

const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai_compatible: 'OpenAI Compatible',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  baidu: '百度千帆',
};

export default function AIProvidersPage() {
  const { hasPermission } = usePermission();
  const [list, setList] = useState<AiProviderConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editTarget, setEditTarget] = useState<AiProviderConfig | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

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

  const filtered = list.filter(
    (item) =>
      !search ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.model.toLowerCase().includes(search.toLowerCase())
  );

  const columns: ColumnProps<AiProviderConfig>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 160,
    },
    {
      title: '供应商类型',
      dataIndex: 'provider',
      width: 160,
      render: (val: AiProvider) => PROVIDER_LABELS[val] ?? val,
    },
    {
      title: 'API 地址',
      dataIndex: 'baseUrl',
      ellipsis: true,
    },
    {
      title: '模型',
      dataIndex: 'model',
      width: 160,
    },
    {
      title: '默认',
      dataIndex: 'isDefault',
      width: 80,
      render: (val: boolean) =>
        val ? <Tag color="blue" size="small">默认</Tag> : null,
    },
    {
      title: '状态',
      dataIndex: 'isEnabled',
      width: 80,
      render: (val: boolean) =>
        val ? <Tag color="green" size="small">启用</Tag> : <Tag color="grey" size="small">禁用</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (val: string) => formatDateTime(val),
    },
    {
      title: '操作',
      dataIndex: 'id',
      width: 210,
      fixed: 'right',
      render: (_: unknown, record: AiProviderConfig) => (
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
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input
          placeholder="搜索名称/模型"
          prefix={<Search size={14} />}
          showClear
          value={search}
          onChange={(v) => setSearch(String(v ?? ''))}
          style={{ width: 220 }}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={() => void loadData()}>
          查询
        </Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setSearch(''); void loadData(); }}>
          重置
        </Button>
        {hasPermission('ai:provider:create') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>
            新增
          </Button>
        )}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={filtered}
        loading={loading}
        rowKey="id"
        pagination={{ pageSize: 20 }}
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
