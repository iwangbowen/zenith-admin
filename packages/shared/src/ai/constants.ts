/**
 * 自定义 OpenAI 兼容端点的 provider ID。
 * 走 Mastra OpenAICompatibleConfig `{ id: 'custom/<model>', url, apiKey }` 直连,
 * 适配私有网关、本地模型(Ollama / LMStudio)与任何未收录进目录的兼容服务。
 */
export const AI_CUSTOM_PROVIDER_ID = 'custom';

/**
 * 常用模型服务商(Mastra 模型目录 provider ID)。
 * 仅作为前端选择器的快捷分组;完整目录(178+ 家)由 `aiProviderContract.catalog`
 * 从 Mastra PROVIDER_REGISTRY 动态提供,后续集成更多服务商无需改代码。
 * id 必须与 Mastra 目录一致(见 @mastra/core/llm 的 getRegisteredProviders())。
 */
export const AI_COMMON_PROVIDERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google Gemini' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'alibaba', label: '阿里云百炼(通义)' },
  { id: 'moonshotai', label: '月之暗面 Kimi' },
  { id: 'zhipuai', label: '智谱 GLM' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'siliconflow', label: '硅基流动' },
  { id: 'xai', label: 'xAI Grok' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'groq', label: 'Groq' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: AI_CUSTOM_PROVIDER_ID, label: '自定义(OpenAI 兼容)' },
];

/** 推理力度档位(Mastra ReasoningLevel,仅支持 reasoning 的模型生效) */
export const AI_REASONING_LEVELS = ['provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

export type AiReasoningLevel = (typeof AI_REASONING_LEVELS)[number];

/** 对话消息角色 */
export const AI_MESSAGE_ROLES = ['system', 'user', 'assistant'] as const;

export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

/** 消息反馈处理状态：pending 待处理 / resolved 已处理 / ignored 已忽略 */
export const AI_FEEDBACK_STATUSES = ['pending', 'resolved', 'ignored'] as const;

export type AiFeedbackStatus = (typeof AI_FEEDBACK_STATUSES)[number];

/** 提示词模板范围：system 系统级 / user 用户私有 */
export const AI_PROMPT_SCOPES = ['system', 'user'] as const;

export type AiPromptScope = (typeof AI_PROMPT_SCOPES)[number];

/** 知识库文档处理状态 */
export const AI_KB_DOCUMENT_STATUSES = ['ready', 'processing', 'failed'] as const;

export type AiKbDocumentStatus = (typeof AI_KB_DOCUMENT_STATUSES)[number];

/** 生成调用链 trace 步骤类型（检索 / 工具执行 / LLM 轮次 / 降级切换） */
export const AI_TRACE_STEP_TYPES = ['retrieval', 'tool_call', 'llm_round', 'failover'] as const;

export type AiTraceStepType = (typeof AI_TRACE_STEP_TYPES)[number];

/** 工具来源：内置 / 管理员配置的 HTTP 工具 */
export const AI_TOOL_SOURCES = ['builtin', 'http'] as const;

export type AiToolSource = (typeof AI_TOOL_SOURCES)[number];

export const AI_HTTP_TOOL_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;

export const AI_HTTP_TOOL_PARAM_TYPES = ['string', 'number', 'boolean'] as const;

/** query = URL 查询参数 / body = JSON body 字段 / path = URL 路径占位符 {name} */
export const AI_HTTP_TOOL_PARAM_LOCATIONS = ['query', 'body', 'path'] as const;

/** 评测实验状态 */
export const AI_EVAL_EXPERIMENT_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

export type AiEvalExperimentStatus = (typeof AI_EVAL_EXPERIMENT_STATUSES)[number];

/** 用户级 AI 设置默认值(DB 稀疏存储,读取时深合并;新增域只需扩展此处与 schema) */
export const AI_USER_SETTINGS_DEFAULTS = {
  instructions: { enabled: true, aboutMe: null, replyStyle: null },
  memory: { enabled: true },
} as const;

/**
 * 评测打分器目录(id 与 Mastra 注册的 scorer.id 一致,实验执行器按 scorer.id 匹配):
 * - code 类:纯算法,零 LLM 成本
 * - llm 类:LLM-as-judge,评审模型 = 系统默认服务商配置,每条消耗 token 并产出评审理由
 * - inverted:反向指标(高分 = 差),前端按好坏着色
 *
 * 不接入的内置 scorer 及原因:
 * - completeness / keyword-coverage / content-similarity:基于英文 NLP(compromise)
 *   或比较 input vs output,对中文语料无效(实测中文数据集关键词覆盖仅 5%,纯噪声)
 * - faithfulness / hallucination:需真实 RAG 检索上下文,实验链路尚未捕获
 */
export const AI_EVAL_SCORERS = [
  { id: 'ground-truth',             kind: 'code', label: '期望答案重合度', description: '输出与期望答案的词面重合度,中英文适用(免费)', needsGroundTruth: true,  inverted: false },
  { id: 'answer-similarity-scorer', kind: 'llm',  label: '语义一致性',     description: '输出与期望答案的语义一致性(LLM 评审)', needsGroundTruth: true,  inverted: false },
  { id: 'answer-relevancy-scorer',  kind: 'llm',  label: '答案相关性',     description: '是否答非所问(LLM 评审)', needsGroundTruth: false, inverted: false },
  { id: 'toxicity-scorer',          kind: 'llm',  label: '毒性检测',       description: '输出的毒性程度,0=无毒(LLM 评审)', needsGroundTruth: false, inverted: true },
  { id: 'bias-scorer',              kind: 'llm',  label: '偏见检测',       description: '输出的偏见程度,0=无偏见(LLM 评审)', needsGroundTruth: false, inverted: true },
] as const;

export type AiEvalScorerId = (typeof AI_EVAL_SCORERS)[number]['id'];

export const AI_EVAL_SCORER_IDS = AI_EVAL_SCORERS.map((s) => s.id) as [AiEvalScorerId, ...AiEvalScorerId[]];
