import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Popconfirm,
  Row,
  SideSheet,
  Space,
  Spin,
  TabPane,
  Tabs,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { Bot, Code2, MessageSquare } from 'lucide-react';
import {
  useMyAiAgents,
  useBuiltinAiAgents,
  useSaveAiAgent,
  useDeleteAiAgent,
} from '@/hooks/queries/ai-agents';
import { useAvailableAiTools } from '@/hooks/queries/ai-tools';
import { useAvailableKnowledgeBases } from '@/hooks/queries/ai-extras';
import { useAiChatModels } from '@/hooks/queries/ai-providers';
import type { AiAgent, AiBuiltinAgent, CreateAiAgentInput } from '@zenith/shared/ai';
import { CreateButton } from '@/components/toolbar-controls';
import { useEditModal } from '@/hooks/useEditModal';

import { useUrlTabState } from '@/hooks/useUrlTabState';
const { Text, Paragraph } = Typography;

const EMOJI_CHOICES = ['🤖', '🧠', '📚', '💼', '🩺', '⚖️', '💻', '✍️', '🌐', '📈', '🎨', '🧮'];

interface AgentFormValues {
  name: string;
  avatar?: string;
  description?: string;
  instructions: string;
  modelValue?: string;
  temperature?: number | null;
  maxSteps?: number | null;
  knowledgeBaseId?: number | null;
  tools?: string[];
  openingMessage?: string;
  suggestedQuestions?: string[];
}

function AgentCard({ agent, footer }: { agent: AiAgent; footer: React.ReactNode }) {
  return (
    <Card
      style={{ width: 300 }}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 8, height: 170 }}
      footer={footer}
      footerLine
    >
      <Space>
        <span style={{ fontSize: 28, lineHeight: '32px' }}>{agent.avatar}</span>
        <div>
          <Text strong ellipsis={{ showTooltip: true }} style={{ maxWidth: 190, display: 'block' }}>{agent.name}</Text>
          <Space spacing={4}>
            {agent.usageCount > 0 && <Tag size="small" color="white">已用 {agent.usageCount} 次</Tag>}
            {!agent.isEnabled && <Tag size="small" color="grey">已停用</Tag>}
          </Space>
        </div>
      </Space>
      <Paragraph type="tertiary" ellipsis={{ rows: 2, showTooltip: true }} style={{ fontSize: 13, flex: 1 }}>
        {agent.description || agent.instructions}
      </Paragraph>
      <Space spacing={4} wrap>
        {agent.knowledgeBaseId && <Tag size="small" color="blue">知识库</Tag>}
        {agent.tools.length > 0 && <Tag size="small" color="purple">{agent.tools.length} 个工具</Tag>}
        {agent.model && <Tag size="small" color="cyan">{agent.model}</Tag>}
        {agent.maxSteps != null && <Tag size="small" color="white">{agent.maxSteps} 步</Tag>}
      </Space>
    </Card>
  );
}

function BuiltinAgentCard({ agent }: { agent: AiBuiltinAgent }) {
  return (
    <Card
      style={{ width: 300 }}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 8, height: 170 }}
      footer={
        <Space>
          <Tag size="small" color="violet" prefixIcon={<Code2 size={11} />}>编程式</Tag>
          <Text type="tertiary" size="small" code>{agent.agentId}</Text>
        </Space>
      }
      footerLine
    >
      <Space>
        <span style={{ fontSize: 28, lineHeight: '32px' }}>{agent.avatar}</span>
        <Text strong ellipsis={{ showTooltip: true }} style={{ maxWidth: 200, display: 'block' }}>{agent.name}</Text>
      </Space>
      <Paragraph type="tertiary" ellipsis={{ rows: 3, showTooltip: true }} style={{ fontSize: 13, flex: 1 }}>
        {agent.description}
      </Paragraph>
    </Card>
  );
}

export default function AiAgentsPage() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useUrlTabState(['mine', 'builtin'] as const, 'mine');
  const mineQuery = useMyAiAgents();
  const builtinQuery = useBuiltinAiAgents();
  const saveMutation = useSaveAiAgent();
  const deleteMutation = useDeleteAiAgent();

  const modal = useEditModal<AiAgent, AgentFormValues, CreateAiAgentInput>({
    save: saveMutation,
    defaults: { avatar: '🤖' },
    toValues: (agent) => ({
      name: agent.name,
      avatar: agent.avatar,
      description: agent.description ?? '',
      instructions: agent.instructions,
      modelValue: agent.configId ? `${agent.configId}:${agent.model ?? ''}` : '',
      temperature: agent.modelSettings?.temperature ?? undefined,
      maxSteps: agent.maxSteps ?? undefined,
      knowledgeBaseId: agent.knowledgeBaseId ?? undefined,
      tools: agent.tools,
      openingMessage: agent.openingMessage ?? '',
      suggestedQuestions: agent.suggestedQuestions,
    }),
    beforeSave: (values) => {
      const [cfgStr, ...modelParts] = (values.modelValue ?? '').split(':');
      const configId = cfgStr ? Number(cfgStr) : null;
      const model = modelParts.join(':') || null;
      return {
        name: values.name,
        avatar: values.avatar || '🤖',
        description: values.description || null,
        instructions: values.instructions,
        configId: configId || null,
        model,
        modelSettings: values.temperature != null ? { temperature: values.temperature } : null,
        maxSteps: values.maxSteps ?? null,
        knowledgeBaseId: values.knowledgeBaseId || null,
        tools: values.tools ?? [],
        openingMessage: values.openingMessage || null,
        suggestedQuestions: (values.suggestedQuestions ?? []).filter(Boolean).slice(0, 6),
      };
    },
    successMessage: ({ isEdit }) => (isEdit ? '智能体已更新' : '智能体已创建'),
    // 最长标签「Agent 指令」带必填星号,110 以下会折行
    labelWidth: 120,
  });

  const toolsQuery = useAvailableAiTools(modal.visible);
  const kbQuery = useAvailableKnowledgeBases(modal.visible);
  const modelsQuery = useAiChatModels();

  /** configId+model 复合选项："configId:model"，空 = 跟随系统默认 */
  const modelOptions = useMemo(() => {
    const models = modelsQuery.data ?? [];
    return [
      { value: '', label: '跟随系统默认' },
      ...models.map((m) => ({ value: `${m.id}:${m.model}`, label: `${m.name} / ${m.model}${m.isDefault ? '（默认）' : ''}` })),
    ];
  }, [modelsQuery.data]);

  const startChat = (agent: AiAgent) => {
    navigate(`/ai/chat?agentId=${agent.id}`);
  };

  const renderMine = () => {
    const list = mineQuery.data ?? [];
    if (mineQuery.isLoading) return <Spin style={{ margin: '48px auto', display: 'block' }} />;
    if (list.length === 0) {
      return <Empty title="还没有智能体" description="创建即用：预设指令 + 绑定知识库 + 勾选工具，同时注册进 Mastra 供评测与 Studio 使用" style={{ marginTop: 48 }} />;
    }
    return (
      <Space wrap align="start" spacing={16}>
        {list.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            footer={
              <Space>
                <Button theme="borderless" size="small" icon={<MessageSquare size={13} />} onClick={() => startChat(agent)}>对话</Button>
                <Button theme="borderless" size="small" onClick={() => modal.openEdit(agent)}>编辑</Button>
                <Popconfirm title="确定要删除该智能体吗？" content="关联对话会保留但不再应用预设" onConfirm={() => deleteMutation.mutateAsync({ params: { id: agent.id } }).then(() => Toast.success('已删除')).catch(() => {})}>
                  <Button theme="borderless" type="danger" size="small">删除</Button>
                </Popconfirm>
              </Space>
            }
          />
        ))}
      </Space>
    );
  };

  const renderBuiltin = () => {
    const list = builtinQuery.data ?? [];
    if (builtinQuery.isLoading) return <Spin style={{ margin: '48px auto', display: 'block' }} />;
    if (list.length === 0) return <Empty title="暂无内置智能体" description="内置智能体由代码定义（含工具与工作流编排示例），注册进 Mastra 后可在评测与 Studio 中使用" style={{ marginTop: 48 }} />;
    return (
      <Space vertical align="start" spacing={12} style={{ width: '100%' }}>
        <Text type="tertiary" style={{ fontSize: 13 }}>
          内置智能体由代码定义（见 services/biz-demo/demo-agent），演示 zod 工具、Workflow 编排与 Agent×Workflow 双向整合；
          注册进 Mastra 后可作为评测实验目标，也可在 Studio 中调试。
        </Text>
        <Space wrap align="start" spacing={16}>
          {list.map((agent) => <BuiltinAgentCard key={agent.agentId} agent={agent} />)}
        </Space>
      </Space>
    );
  };

  return (
    <div className="page-container page-tabs-page">
      <Tabs
        collapsible="auto"
        type="line"
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as typeof activeTab)}
        tabBarExtraContent={
          <CreateButton onClick={modal.openCreate}>新建智能体</CreateButton>
        }
      >
        <TabPane tab={<span><Bot size={14} style={{ verticalAlign: -2, marginRight: 4 }} />我的智能体</span>} itemKey="mine">
          <div style={{ padding: '16px 0' }}>{renderMine()}</div>
        </TabPane>
        <TabPane tab={<span><Code2 size={14} style={{ verticalAlign: -2, marginRight: 4 }} />内置智能体</span>} itemKey="builtin">
          <div style={{ padding: '16px 0' }}>{renderBuiltin()}</div>
        </TabPane>
      </Tabs>

      <SideSheet
        title={modal.isEdit ? '编辑智能体' : '新建智能体'}
        visible={modal.visible}
        onCancel={modal.close}
        closeOnEsc
        width={640}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="tertiary" onClick={modal.close}>取消</Button>
            <Button
              type="primary"
              theme="solid"
              loading={modal.modalProps.okButtonProps.loading}
              disabled={modal.modalProps.okButtonProps.disabled}
              onClick={() => void modal.modalProps.onOk()}
            >
              保存
            </Button>
          </div>
        )}
      >
        <Spin spinning={modal.detailLoading}>
          <Form
            key={modal.formKey} {...modal.formProps}
          >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={100} placeholder="如：合同审阅助手" />
            </Col>
            <Col span={12}>
              <Form.Select field="avatar" label="头像" style={{ width: '100%' }}>
                {EMOJI_CHOICES.map((e) => <Form.Select.Option key={e} value={e}>{e}</Form.Select.Option>)}
              </Form.Select>
            </Col>
          </Row>
          <Form.Input field="description" label="描述" maxLength={300} placeholder="一句话介绍" />
          <Form.TextArea field="instructions" label="Agent 指令" rules={[{ required: true, message: '请输入指令' }]} maxCount={8192} rows={5} placeholder="定义智能体的角色、能力边界与回答风格（Mastra instructions）" />
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="modelValue" label="模型" optionList={modelOptions} style={{ width: '100%' }} placeholder="跟随系统默认" />
            </Col>
            <Col span={12}>
              <Form.Select
                field="knowledgeBaseId"
                label="知识库"
                style={{ width: '100%' }}
                placeholder="不绑定"
                showClear
                optionList={(kbQuery.data ?? []).map((kb) => ({ value: kb.id, label: `${kb.name}（${kb.documentCount} 文档）` }))}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.InputNumber field="temperature" label="温度" min={0} max={2} step={0.1} style={{ width: '100%' }} placeholder="跟随模型默认" extraText="采样温度 0-2，留空跟随默认" />
            </Col>
            <Col span={12}>
              <Form.InputNumber field="maxSteps" label="最大步数" min={1} max={20} style={{ width: '100%' }} placeholder="系统默认" extraText="工具调用循环上限" />
            </Col>
          </Row>
          <Form.Select
            field="tools"
            label="工具"
            multiple
            style={{ width: '100%' }}
            placeholder="不启用工具"
            optionList={(toolsQuery.data ?? []).map((t) => ({ value: t.name, label: `${t.name}（${t.source === 'builtin' ? '内置' : 'HTTP'}）` }))}
          />
          <Form.TextArea field="openingMessage" label="开场白" rows={2} maxCount={2000} placeholder="新对话开始时展示给用户的欢迎语" />
          <Form.TagInput field="suggestedQuestions" label="建议问题" max={6} placeholder="输入后回车添加（最多 6 条）" style={{ width: '100%' }} />
          </Form>
        </Spin>
      </SideSheet>
    </div>
  );
}
