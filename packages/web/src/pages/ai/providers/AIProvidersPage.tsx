import React, { useState, useEffect, useCallback } from 'react';
import { Button, Form, Modal, Popconfirm, Space, Switch, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import type { AiProvider, AiProviderConfig } from '@zenith/shared';

const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai_compatible: 'OpenAI Compatible',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  baidu: '百度千帆',
};

const PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
  { value: 'openai_compatible', label: 'OpenAI Compatible' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'baidu', label: '百度千帆' },
];

interface FormValues {
  name: string;
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string | null;
  maxTokens: number;
  temperature: string;
  isDefault: boolean;
  isEnabled: boolean;
}

export default function AIProvidersPage() {
  const { hasPermission } = usePermission();
  const [list, setList] = useState<AiProviderConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editTarget, setEditTarget] = useState<AiProviderConfig | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [form, setForm] = useState<FormValues>({
    name: '',
    provider: 'openai_compatible',
    baseUrl: '',
    apiKey: '',
    model: '',
    systemPrompt: null,
    maxTokens: 4096,
    temperature: '0.7',
    isDefault: false,
    isEnabled: true,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<{ list: AiProviderConfig[] }>('/api/ai/providers');
      setList(res.data?.list ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openCreate = () => {
    setEditTarget(null);
    setForm({
      name: '',
      provider: 'openai_compatible',
      baseUrl: '',
      apiKey: '',
      model: '',
      systemPrompt: null,
      maxTokens: 4096,
      temperature: '0.7',
      isDefault: false,
      isEnabled: true,
    });
    setModalVisible(true);
  };

  const openEdit = (record: AiProviderConfig) => {
    setEditTarget(record);
    setForm({
      name: record.name,
      provider: record.provider,
      baseUrl: record.baseUrl,
      apiKey: record.apiKey,
      model: record.model,
      systemPrompt: record.systemPrompt,
      maxTokens: record.maxTokens,
      temperature: record.temperature,
      isDefault: record.isDefault,
      isEnabled: record.isEnabled,
    });
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    setSubmitLoading(true);
    try {
      if (editTarget) {
        await request.put(`/api/ai/providers/${editTarget.id}`, form);
        Toast.success('修改成功');
      } else {
        await request.post('/api/ai/providers', form);
        Toast.success('创建成功');
      }
      setModalVisible(false);
      void loadData();
    } catch {
      // error handled by request interceptor
    } finally {
      setSubmitLoading(false);
    }
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
    <>
      <SearchToolbar>
        <Form.Input
          noLabel
          field="search"
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

      <Modal
        title={editTarget ? '编辑服务商' : '新增服务商'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => void handleSubmit()}
        okButtonProps={{ loading: submitLoading }}
        width={600}
      >
        <Form labelPosition="left" labelWidth={100}>
          <Form.Input
            field="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
            value={form.name}
            onChange={(v) => setForm((f) => ({ ...f, name: String(v ?? '') }))}
          />
          <Form.Select
            field="provider"
            label="供应商类型"
            value={form.provider}
            onChange={(v) => setForm((f) => ({ ...f, provider: v as AiProvider }))}
            optionList={PROVIDER_OPTIONS}
            style={{ width: '100%' }}
          />
          <Form.Input
            field="baseUrl"
            label="API 地址"
            rules={[{ required: true, message: '请输入 API 地址' }]}
            value={form.baseUrl}
            onChange={(v) => setForm((f) => ({ ...f, baseUrl: String(v ?? '') }))}
            placeholder="https://api.openai.com/v1"
          />
          <Form.Input
            field="apiKey"
            label="API Key"
            rules={[{ required: !editTarget, message: '请输入 API Key' }]}
            value={form.apiKey}
            onChange={(v) => setForm((f) => ({ ...f, apiKey: String(v ?? '') }))}
            mode="password"
            placeholder={editTarget ? '不修改请留空（留空将保留原值）' : ''}
          />
          <Form.Input
            field="model"
            label="模型"
            rules={[{ required: true, message: '请输入模型名称' }]}
            value={form.model}
            onChange={(v) => setForm((f) => ({ ...f, model: String(v ?? '') }))}
            placeholder="gpt-4o"
          />
          <Form.TextArea
            field="systemPrompt"
            label="系统提示词"
            value={form.systemPrompt ?? ''}
            onChange={(v) => setForm((f) => ({ ...f, systemPrompt: v ? String(v) : null }))}
            rows={3}
            placeholder="可选，为空则使用默认提示词"
          />
          <Form.InputNumber
            field="maxTokens"
            label="最大 Token"
            value={form.maxTokens}
            onChange={(v) => setForm((f) => ({ ...f, maxTokens: Number(v ?? 4096) }))}
            min={1}
            max={128000}
          />
          <Form.Input
            field="temperature"
            label="温度"
            value={form.temperature}
            onChange={(v) => setForm((f) => ({ ...f, temperature: String(v ?? '0.7') }))}
            placeholder="0.7"
          />
          <Form.Slot label="默认">
            <Switch
              checked={form.isDefault}
              onChange={(v) => setForm((f) => ({ ...f, isDefault: Boolean(v) }))}
            />
          </Form.Slot>
          <Form.Slot label="启用">
            <Switch
              checked={form.isEnabled}
              onChange={(v) => setForm((f) => ({ ...f, isEnabled: Boolean(v) }))}
            />
          </Form.Slot>
        </Form>
      </Modal>

    </>
  );
}
