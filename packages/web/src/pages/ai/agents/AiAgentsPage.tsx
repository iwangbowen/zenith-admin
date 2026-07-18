import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Empty,
  Form,
  Modal,
  Popconfirm,
  Space,
  Spin,
  TabPane,
  Tabs,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { Bot, MessageSquare, Copy, Send, Undo2, Check, X, Plus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  useMyAiAgents,
  useMarketAiAgents,
  usePendingAiAgents,
  useSaveAiAgent,
  useDeleteAiAgent,
  usePublishAiAgent,
  useReviewAiAgent,
  useCloneAiAgent,
} from '@/hooks/queries/ai-agents';
import { useAvailableAiTools } from '@/hooks/queries/ai-tools';
import { useAvailableKnowledgeBases } from '@/hooks/queries/ai-extras';
import { useAiChatModels } from '@/hooks/queries/ai-providers';
import { AI_AGENT_STATUS_LABELS } from '@zenith/shared';
import type { AiAgent, CreateAiAgentInput } from '@zenith/shared';

const { Text, Paragraph } = Typography;

const STATUS_COLORS: Record<AiAgent['status'], 'grey' | 'amber' | 'green' | 'red'> = {
  private: 'grey',
  pending: 'amber',
  published: 'green',
  rejected: 'red',
};

const EMOJI_CHOICES = ['🤖', '🧠', '📚', '💼', '🩺', '⚖️', '💻', '✍️', '🌐', '📈', '🎨', '🧮'];

interface AgentFormValues {
  name: string;
  avatar?: string;
  description?: string;
  systemPrompt: string;
  modelValue?: string;
  knowledgeBaseId?: number | null;
  tools?: string[];
  openingMessage?: string;
  suggestedQuestions?: string[];
}

function AgentCard({ agent, footer, showOwner }: { agent: AiAgent; footer: React.ReactNode; showOwner?: boolean }) {
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
            <Tag size="small" color={STATUS_COLORS[agent.status]}>{AI_AGENT_STATUS_LABELS[agent.status]}</Tag>
            {agent.usageCount > 0 && <Tag size="small" color="white">已用 {agent.usageCount} 次</Tag>}
          </Space>
        </div>
      </Space>
      <Paragraph type="tertiary" ellipsis={{ rows: 2, showTooltip: true }} style={{ fontSize: 13, flex: 1 }}>
        {agent.description || agent.systemPrompt}
      </Paragraph>
      <Space spacing={4} wrap>
        {agent.knowledgeBaseId && <Tag size="small" color="blue">知识库</Tag>}
        {agent.tools.length > 0 && <Tag size="small" color="purple">{agent.tools.length} 个工具</Tag>}
        {agent.model && <Tag size="small" color="cyan">{agent.model}</Tag>}
        {showOwner && agent.ownerName && <Tag size="small" color="white">@{agent.ownerName}</Tag>}
      </Space>
    </Card>
  );
}

export default function AiAgentsPage() {
  const navigate = useNavigate();
  const { permissions } = useAuth();
  const canReview = permissions.includes('*') || permissions.includes('ai:agent:review');

  const [activeTab, setActiveTab] = useState('mine');
  const mineQuery = useMyAiAgents();
  const marketQuery = useMarketAiAgents();
  const pendingQuery = usePendingAiAgents(canReview);
  const saveMutation = useSaveAiAgent();
  const deleteMutation = useDeleteAiAgent();
  const publishMutation = usePublishAiAgent();
  const reviewMutation = useReviewAiAgent();
  const cloneMutation = useCloneAiAgent();

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<AiAgent | null>(null);
  const [formApi, setFormApi] = useState<{ validate: () => Promise<AgentFormValues> } | null>(null);

  const toolsQuery = useAvailableAiTools(modalVisible);
  const kbQuery = useAvailableKnowledgeBases(modalVisible);
  const modelsQuery = useAiChatModels();

  /** configId+model 复合选项："configId:model"，空 = 跟随系统默认 */
  const modelOptions = useMemo(() => {
    const models = modelsQuery.data ?? [];
    return [
      { value: '', label: '跟随系统默认' },
      ...models.map((m) => ({ value: `${m.id}:${m.model}`, label: `${m.name} / ${m.model}${m.isDefault ? '（默认）' : ''}` })),
    ];
  }, [modelsQuery.data]);

  const openCreate = () => {
    setEditing(null);
    setModalVisible(true);
  };

  const openEdit = (agent: AiAgent) => {
    setEditing(agent);
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    if (!formApi) return;
    let values: AgentFormValues;
    try {
      values = await formApi.validate();
    } catch {
      return;
    }
    const [cfgStr, ...modelParts] = (values.modelValue ?? '').split(':');
    const configId = cfgStr ? Number(cfgStr) : null;
    const model = modelParts.join(':') || null;
    const payload: CreateAiAgentInput = {
      name: values.name,
      avatar: values.avatar || '🤖',
      description: values.description || null,
      systemPrompt: values.systemPrompt,
      configId: configId || null,
      model,
      knowledgeBaseId: values.knowledgeBaseId || null,
      tools: values.tools ?? [],
      openingMessage: values.openingMessage || null,
      suggestedQuestions: (values.suggestedQuestions ?? []).filter(Boolean).slice(0, 6),
    };
    try {
      await saveMutation.mutateAsync({ id: editing?.id, values: payload });
      Toast.success(editing ? '智能体已更新' : '智能体已创建');
      setModalVisible(false);
    } catch { /* 错误 Toast 已由请求层处理 */ }
  };

  const startChat = (agent: AiAgent) => {
    navigate(`/ai/chat?agentId=${agent.id}`);
  };

  const renderMine = () => {
    const list = mineQuery.data ?? [];
    if (mineQuery.isLoading) return <Spin style={{ margin: '48px auto', display: 'block' }} />;
    if (list.length === 0) {
      return <Empty title="还没有智能体" description="创建你的第一个智能体：预设提示词 + 绑定知识库 + 勾选工具" style={{ marginTop: 48 }} />;
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
                <Button theme="borderless" size="small" onClick={() => openEdit(agent)}>编辑</Button>
                {(agent.status === 'private' || agent.status === 'rejected') && (
                  <Button
                    theme="borderless"
                    size="small"
                    icon={<Send size={13} />}
                    onClick={() => publishMutation.mutateAsync({ id: agent.id, action: 'publish' }).then(() => Toast.success('已提交审核')).catch(() => {})}
                  >上架</Button>
                )}
                {(agent.status === 'published' || agent.status === 'pending') && (
                  <Button
                    theme="borderless"
                    size="small"
                    icon={<Undo2 size={13} />}
                    onClick={() => publishMutation.mutateAsync({ id: agent.id, action: 'unpublish' }).then(() => Toast.success('已撤回')).catch(() => {})}
                  >撤回</Button>
                )}
                <Popconfirm title="确定要删除该智能体吗？" content="关联对话会保留但不再应用预设" onConfirm={() => deleteMutation.mutateAsync(agent.id).then(() => Toast.success('已删除')).catch(() => {})}>
                  <Button theme="borderless" type="danger" size="small">删除</Button>
                </Popconfirm>
              </Space>
            }
          />
        ))}
      </Space>
    );
  };

  const renderMarket = () => {
    const list = marketQuery.data ?? [];
    if (marketQuery.isLoading) return <Spin style={{ margin: '48px auto', display: 'block' }} />;
    if (list.length === 0) return <Empty title="市场暂无智能体" description="上架的智能体会展示在这里，供所有人使用" style={{ marginTop: 48 }} />;
    return (
      <Space wrap align="start" spacing={16}>
        {list.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            showOwner
            footer={
              <Space>
                <Button theme="borderless" size="small" icon={<MessageSquare size={13} />} onClick={() => startChat(agent)}>对话</Button>
                <Button
                  theme="borderless"
                  size="small"
                  icon={<Copy size={13} />}
                  onClick={() => cloneMutation.mutateAsync(agent.id).then(() => { Toast.success('已克隆为我的智能体'); setActiveTab('mine'); }).catch(() => {})}
                >克隆</Button>
              </Space>
            }
          />
        ))}
      </Space>
    );
  };

  const renderReview = () => {
    const list = pendingQuery.data ?? [];
    if (pendingQuery.isLoading) return <Spin style={{ margin: '48px auto', display: 'block' }} />;
    if (list.length === 0) return <Empty title="没有待审核的智能体" style={{ marginTop: 48 }} />;
    return (
      <Space wrap align="start" spacing={16}>
        {list.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            showOwner
            footer={
              <Space>
                <Button theme="borderless" size="small" icon={<Check size={13} />} onClick={() => reviewMutation.mutateAsync({ id: agent.id, approve: true }).then(() => Toast.success('已通过上架')).catch(() => {})}>通过</Button>
                <Button theme="borderless" type="danger" size="small" icon={<X size={13} />} onClick={() => reviewMutation.mutateAsync({ id: agent.id, approve: false }).then(() => Toast.success('已驳回')).catch(() => {})}>驳回</Button>
              </Space>
            }
          />
        ))}
      </Space>
    );
  };

  const editingModelValue = editing?.configId ? `${editing.configId}:${editing.model ?? ''}` : '';

  return (
    <div className="page-container page-tabs-page">
      <Tabs
        type="line"
        activeKey={activeTab}
        onChange={setActiveTab}
        tabBarExtraContent={
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新建智能体</Button>
        }
      >
        <TabPane tab={<span><Bot size={14} style={{ verticalAlign: -2, marginRight: 4 }} />我的智能体</span>} itemKey="mine">
          <div style={{ padding: '16px 0' }}>{renderMine()}</div>
        </TabPane>
        <TabPane tab="智能体市场" itemKey="market">
          <div style={{ padding: '16px 0' }}>{renderMarket()}</div>
        </TabPane>
        {canReview && (
          <TabPane tab={`上架审核${(pendingQuery.data?.length ?? 0) > 0 ? `（${pendingQuery.data!.length}）` : ''}`} itemKey="review">
            <div style={{ padding: '16px 0' }}>{renderReview()}</div>
          </TabPane>
        )}
      </Tabs>

      <Modal
        title={editing ? '编辑智能体' : '新建智能体'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleSubmit}
        confirmLoading={saveMutation.isPending}
        width={640}
        closeOnEsc
      >
        <Form
          labelPosition="left"
          labelWidth={100}
          getFormApi={(api) => setFormApi(api as unknown as { validate: () => Promise<AgentFormValues> })}
          key={editing?.id ?? 'new'}
          initValues={editing ? {
            name: editing.name,
            avatar: editing.avatar,
            description: editing.description ?? '',
            systemPrompt: editing.systemPrompt,
            modelValue: editingModelValue,
            knowledgeBaseId: editing.knowledgeBaseId ?? undefined,
            tools: editing.tools,
            openingMessage: editing.openingMessage ?? '',
            suggestedQuestions: editing.suggestedQuestions,
          } : { avatar: '🤖' }}
        >
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={100} placeholder="如：合同审阅助手" />
          <Form.Select field="avatar" label="头像" style={{ width: 120 }}>
            {EMOJI_CHOICES.map((e) => <Form.Select.Option key={e} value={e}>{e}</Form.Select.Option>)}
          </Form.Select>
          <Form.Input field="description" label="描述" maxLength={300} placeholder="一句话介绍（市场展示）" />
          <Form.TextArea field="systemPrompt" label="系统提示词" rules={[{ required: true, message: '请输入提示词' }]} maxCount={8192} rows={5} placeholder="定义智能体的角色、能力边界与回答风格" />
          <Form.Select field="modelValue" label="模型" optionList={modelOptions} style={{ width: '100%' }} placeholder="跟随系统默认" />
          <Form.Select
            field="knowledgeBaseId"
            label="知识库"
            style={{ width: '100%' }}
            placeholder="不绑定"
            showClear
            optionList={(kbQuery.data ?? []).map((kb) => ({ value: kb.id, label: `${kb.name}（${kb.documentCount} 文档）` }))}
          />
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
      </Modal>
    </div>
  );
}
