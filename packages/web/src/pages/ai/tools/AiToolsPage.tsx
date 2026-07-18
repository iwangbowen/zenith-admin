import { useState } from 'react';
import {
  ArrayField,
  Button,
  Form,
  Modal,
  Space,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { useAiHttpTools, useSaveAiHttpTool, useDeleteAiHttpTool } from '@/hooks/queries/ai-tools';
import type { AiHttpTool, AiHttpToolParam, CreateAiHttpToolInput } from '@zenith/shared';

const { Text } = Typography;

interface ToolFormValues {
  name: string;
  description: string;
  method: string;
  urlTemplate: string;
  headersText?: string;
  params?: AiHttpToolParam[];
  isEnabled?: boolean;
}

export default function AiToolsPage() {
  const listQuery = useAiHttpTools();
  const saveMutation = useSaveAiHttpTool();
  const deleteMutation = useDeleteAiHttpTool();

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<AiHttpTool | null>(null);
  const [formApi, setFormApi] = useState<{ validate: () => Promise<ToolFormValues> } | null>(null);

  const openCreate = () => { setEditing(null); setModalVisible(true); };
  const openEdit = (tool: AiHttpTool) => { setEditing(tool); setModalVisible(true); };

  const handleSubmit = async () => {
    if (!formApi) return;
    let values: ToolFormValues;
    try {
      values = await formApi.validate();
    } catch {
      return;
    }
    let headers: Record<string, string> | null = null;
    if (values.headersText?.trim()) {
      try {
        headers = JSON.parse(values.headersText) as Record<string, string>;
      } catch {
        Toast.error('请求头必须是合法 JSON 对象');
        return;
      }
    }
    const payload: CreateAiHttpToolInput = {
      name: values.name,
      description: values.description,
      method: values.method as CreateAiHttpToolInput['method'],
      urlTemplate: values.urlTemplate,
      headers,
      params: (values.params ?? []).filter((p) => p?.name),
      isEnabled: values.isEnabled ?? true,
    };
    try {
      await saveMutation.mutateAsync({ id: editing?.id, values: payload });
      Toast.success(editing ? '工具已更新' : '工具已创建');
      setModalVisible(false);
    } catch { /* 请求层已提示 */ }
  };

  const columns = [
    {
      title: '工具名',
      dataIndex: 'name',
      width: 200,
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      width: 280,
      render: (v: string) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 260, fontSize: 13 }}>{v}</Text>,
    },
    { title: '方法', dataIndex: 'method', width: 80, render: (v: string) => <Tag size="small" color={v === 'GET' ? 'blue' : 'orange'}>{v}</Tag> },
    {
      title: 'URL 模板',
      dataIndex: 'urlTemplate',
      width: 300,
      render: (v: string) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 280, fontSize: 12 }}>{v}</Text>,
    },
    { title: '参数数', dataIndex: 'params', width: 80, render: (v: AiHttpToolParam[]) => v?.length ?? 0 },
    {
      title: '状态',
      dataIndex: 'isEnabled',
      width: 80,
      fixed: 'right' as const,
      render: (v: boolean) => <Tag size="small" color={v ? 'green' : 'grey'}>{v ? '启用' : '禁用'}</Tag>,
    },
    createOperationColumn<AiHttpTool>({
      width: 140,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        { key: 'edit', label: '编辑', onClick: () => openEdit(record) },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该工具吗？',
              content: '已勾选此工具的智能体将无法再调用',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: async () => {
                await deleteMutation.mutateAsync(record.id).then(() => Toast.success('已删除')).catch(() => {});
              },
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text type="tertiary" style={{ fontSize: 13 }}>
          将企业内部 / 第三方 HTTP API 注册为 Function Calling 工具，智能体与对话可勾选调用（出站默认启用 SSRF 防护）
        </Text>
        <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增工具</Button>
      </div>
      <ConfigurableTable
        bordered
        columnSettingsKey="ai-http-tools"
        columns={columns}
        dataSource={listQuery.data ?? []}
        rowKey="id"
        loading={listQuery.isFetching}
        pagination={false}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
      />

      <Modal
        title={editing ? '编辑工具' : '新增工具'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleSubmit}
        confirmLoading={saveMutation.isPending}
        width={720}
        closeOnEsc
      >
        <Form
          labelPosition="left"
          labelWidth={90}
          getFormApi={(api) => setFormApi(api as unknown as { validate: () => Promise<ToolFormValues> })}
          key={editing?.id ?? 'new'}
          initValues={editing ? {
            name: editing.name,
            description: editing.description,
            method: editing.method,
            urlTemplate: editing.urlTemplate,
            headersText: editing.headers ? JSON.stringify(editing.headers, null, 2) : '',
            params: editing.params,
            isEnabled: editing.isEnabled,
          } : { method: 'GET', isEnabled: true, params: [] }}
        >
          <Form.Input
            field="name"
            label="工具名"
            rules={[
              { required: true, message: '请输入工具名' },
              { pattern: /^[a-z][a-z0-9_]{1,59}$/, message: '仅限小写字母/数字/下划线，字母开头' },
            ]}
            placeholder="如：query_order_status（LLM 通过该名称调用）"
          />
          <Form.TextArea field="description" label="描述" rules={[{ required: true, message: '请输入描述' }]} rows={2} maxCount={500} placeholder="告诉模型这个工具能做什么、什么时候调用（写清楚可显著提升调用准确率）" />
          <Form.Select field="method" label="方法" style={{ width: 140 }} optionList={['GET', 'POST', 'PUT', 'DELETE'].map((m) => ({ value: m, label: m }))} />
          <Form.Input field="urlTemplate" label="URL 模板" rules={[{ required: true, message: '请输入 URL' }]} placeholder="https://api.example.com/orders/{orderId}（支持 {param} 路径占位符）" />
          <Form.TextArea field="headersText" label="请求头" rows={2} placeholder='可选，JSON 对象，如 {"Authorization": "Bearer xxx"}' />
          <Form.Switch field="isEnabled" label="启用" />
          <Form.Slot label={{ text: '参数定义' }}>
            <ArrayField field="params">
              {({ add, arrayFields }) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {arrayFields.map(({ field, key, remove }) => (
                    <Space key={key} align="start">
                      <Form.Input noLabel field={`${field}[name]`} placeholder="参数名" style={{ width: 120 }} rules={[{ required: true, message: '必填' }]} />
                      <Form.Select noLabel field={`${field}[type]`} initValue="string" style={{ width: 92 }} optionList={[{ value: 'string', label: 'string' }, { value: 'number', label: 'number' }, { value: 'boolean', label: 'boolean' }]} />
                      <Form.Select noLabel field={`${field}[location]`} initValue="query" style={{ width: 92 }} optionList={[{ value: 'query', label: 'query' }, { value: 'body', label: 'body' }, { value: 'path', label: 'path' }]} />
                      <Form.Input noLabel field={`${field}[description]`} placeholder="参数说明（供 LLM 理解）" style={{ width: 220 }} rules={[{ required: true, message: '必填' }]} />
                      <Form.Checkbox noLabel field={`${field}[required]`} initValue={false}>必填</Form.Checkbox>
                      <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={13} />} onClick={() => remove()} />
                    </Space>
                  ))}
                  <Button theme="light" size="small" icon={<Plus size={13} />} onClick={() => add()} style={{ alignSelf: 'flex-start' }}>添加参数</Button>
                </div>
              )}
            </ArrayField>
          </Form.Slot>
        </Form>
      </Modal>
    </div>
  );
}
