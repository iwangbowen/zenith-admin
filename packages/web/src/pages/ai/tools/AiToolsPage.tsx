import {
  ArrayField,
  Button,
  Col,
  Form,
  Modal,
  Row,
  Space,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { useAiHttpTools, useSaveAiHttpTool, useDeleteAiHttpTool } from '@/hooks/queries/ai-tools';
import type { AiHttpTool, AiHttpToolParam, CreateAiHttpToolInput } from '@zenith/shared/ai';
import { CreateButton } from '@/components/toolbar-controls';
import { confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';

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

  const modal = useEditModal<AiHttpTool, ToolFormValues, CreateAiHttpToolInput>({
    save: saveMutation,
    defaults: { method: 'GET', isEnabled: true, params: [] },
    toValues: (tool) => ({
      name: tool.name,
      description: tool.description,
      method: tool.method,
      urlTemplate: tool.urlTemplate,
      headersText: tool.headers ? JSON.stringify(tool.headers, null, 2) : '',
      params: tool.params,
      isEnabled: tool.isEnabled,
    }),
    beforeSave: (values) => {
    let headers: Record<string, string> | null = null;
    if (values.headersText?.trim()) {
      try {
        headers = JSON.parse(values.headersText) as Record<string, string>;
      } catch {
        Toast.error('请求头必须是合法 JSON 对象');
        abortSubmit();
      }
    }
      return {
      name: values.name,
      description: values.description,
      method: values.method as CreateAiHttpToolInput['method'],
      urlTemplate: values.urlTemplate,
      headers,
      params: (values.params ?? []).filter((p) => p?.name),
      isEnabled: values.isEnabled ?? true,
    };
    },
    successMessage: ({ isEdit }) => (isEdit ? '工具已更新' : '工具已创建'),
  });

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
      minWidth: 280,
      render: (v: string) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 260, fontSize: 13 }}>{v}</Text>,
    },
    { title: '方法', dataIndex: 'method', width: 80, render: (v: string) => <Tag size="small" color={v === 'GET' ? 'blue' : 'orange'}>{v}</Tag> },
    {
      title: 'URL 模板',
      dataIndex: 'urlTemplate',
      width: 300,
      render: (v: string) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 280, fontSize: 12 }}>{v}</Text>,
    },
    { title: '参数数', dataIndex: 'params', width: 80, align: 'right' as const, render: (v: AiHttpToolParam[]) => v?.length ?? 0 },
    {
      title: '状态',
      dataIndex: 'isEnabled',
      width: 80,
      fixed: 'right' as const,
      render: (v: boolean) => <Tag size="small" color={v ? 'green' : 'grey'}>{v ? '启用' : '禁用'}</Tag>,
    },
    createOperationColumn<AiHttpTool>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        { key: 'edit', label: '编辑', onClick: () => modal.openEdit(record) },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            confirmDelete({
              title: '确定要删除该工具吗？',
              content: '已勾选此工具的智能体将无法再调用',
              onOk: async () => {
                await deleteMutation.mutateAsync({ params: { id: record.id } }).then(() => Toast.success('已删除')).catch(() => {});
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
        <CreateButton onClick={modal.openCreate}>新增工具</CreateButton>
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
        {...modal.modalProps}
        title={modal.isEdit ? '编辑工具' : '新增工具'}
        width={720}
      >
        <Form
          key={modal.formKey} {...modal.formProps}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input
                field="name"
                label="工具名"
                rules={[
                  { required: true, message: '请输入工具名' },
                  { pattern: /^[a-z][a-z0-9_]{1,59}$/, message: '仅限小写字母/数字/下划线，字母开头' },
                ]}
                placeholder="LLM 通过该名称调用"
              />
            </Col>
            <Col span={12}>
              <Form.Select field="method" label="方法" style={{ width: '100%' }} optionList={['GET', 'POST', 'PUT', 'DELETE'].map((m) => ({ value: m, label: m }))} />
            </Col>
          </Row>
          <Form.Input field="urlTemplate" label="URL 模板" rules={[{ required: true, message: '请输入 URL' }]} placeholder="https://api.example.com/orders/{orderId}（支持 {param} 路径占位符）" />
          <Form.TextArea field="description" label="描述" rules={[{ required: true, message: '请输入描述' }]} rows={2} maxCount={500} placeholder="告诉模型这个工具能做什么、什么时候调用（写清楚可显著提升调用准确率）" />
          <Form.TextArea field="headersText" label="请求头" rows={2} placeholder='可选，JSON 对象，如 {"Authorization": "Bearer xxx"}' />
          <Row gutter={16}>
            <Col span={12}>
              <Form.Switch field="isEnabled" label="启用" />
            </Col>
          </Row>
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
