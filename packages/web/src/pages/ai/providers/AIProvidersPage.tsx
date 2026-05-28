import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Col, Form, Input, Modal, Popconfirm, Row, Space, Tag, Toast } from '@douyinfe/semi-ui';
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
  const [modalDetailLoading, setModalDetailLoading] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [formInitValues, setFormInitValues] = useState<FormValues>({
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
  const formApiRef = useRef<{ getValues: () => FormValues } | null>(null);

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
    setFormInitValues({
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
    setFormKey((k) => k + 1);
    setModalVisible(true);
  };

  const openEdit = async (record: AiProviderConfig) => {
    setEditTarget(record);
    setFormInitValues({
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
    setFormKey((k) => k + 1);
    setModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<AiProviderConfig>(`/api/ai/providers/${record.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditTarget(res.data);
      setFormInitValues({
        name: res.data.name,
        provider: res.data.provider,
        baseUrl: res.data.baseUrl,
        apiKey: res.data.apiKey,
        model: res.data.model,
        systemPrompt: res.data.systemPrompt,
        maxTokens: res.data.maxTokens,
        temperature: res.data.temperature,
        isDefault: res.data.isDefault,
        isEnabled: res.data.isEnabled,
      });
      setFormKey((k) => k + 1);
    } else {
      Toast.error(res.message || '获取服务商信息失败');
    }
  };

  const handleSubmit = async () => {
    setSubmitLoading(true);
    try {
      const values = formApiRef.current?.getValues();
      if (!values) return;
      if (editTarget) {
        await request.put(`/api/ai/providers/${editTarget.id}`, values);
        Toast.success('修改成功');
      } else {
        await request.post('/api/ai/providers', values);
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

      <Modal
        title={editTarget ? '编辑服务商' : '新增服务商'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditTarget(null); setModalDetailLoading(false); }}
        onOk={() => void handleSubmit()}
        okButtonProps={{ loading: submitLoading, disabled: modalDetailLoading }}
        width={720}
      >
        <Form
          key={formKey}
          labelPosition="left"
          labelWidth={90}
          initValues={formInitValues}
          getFormApi={(api) => { formApiRef.current = api; }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input
                field="name"
                label="名称"
                rules={[{ required: true, message: '请输入名称' }]}
              />
            </Col>
            <Col span={12}>
              <Form.Select
                field="provider"
                label="供应商类型"
                optionList={PROVIDER_OPTIONS}
                style={{ width: '100%' }}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input
                field="baseUrl"
                label="API 地址"
                rules={[{ required: true, message: '请输入 API 地址' }]}
                placeholder="https://api.openai.com/v1"
              />
            </Col>
            <Col span={12}>
              <Form.Input
                field="apiKey"
                label="API Key"
                rules={[{ required: !editTarget, message: '请输入 API Key' }]}
                mode="password"
                placeholder={editTarget ? '留空保留原值' : ''}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input
                field="model"
                label="模型"
                rules={[{ required: true, message: '请输入模型名称' }]}
                placeholder="gpt-4o"
              />
            </Col>
            <Col span={12}>
              <Form.Input
                field="temperature"
                label="温度"
                placeholder="0.7"
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.InputNumber
                field="maxTokens"
                label="最大 Token"
                min={1}
                max={128000}
              />
            </Col>
            <Col span={12}>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Switch field="isDefault" label="默认" />
                </Col>
                <Col span={12}>
                  <Form.Switch field="isEnabled" label="启用" />
                </Col>
              </Row>
            </Col>
          </Row>
          <Form.TextArea
            field="systemPrompt"
            label="系统提示词"
            rows={3}
            placeholder="可选，为空则使用默认提示词"
          />
        </Form>
      </Modal>

    </div>
  );
}
