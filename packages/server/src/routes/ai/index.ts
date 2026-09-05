import {
  aiAgentContract,
  aiArenaContract,
  aiAuditContract,
  aiChatModelContract,
  aiConversationContract,
  aiEvalContract,
  aiGenerationContract,
  aiHttpToolContract,
  aiKnowledgeBaseContract,
  aiPromptTemplateContract,
  aiProviderContract,
  aiPublicContract,
  aiSettingsContract,
  aiUsageContract,
  userAiConfigContract,
} from '@zenith/shared/ai';
import { defineRouteDomain } from '../_kit';
import aiAgentsRoutes from './ai-agents';
import aiArenaRoutes from './ai-arena';
import aiAuditRoutes from './ai-audit';
import aiChatRoutes from './ai-chat';
import aiConversationExtrasRoutes from './ai-conversation-extras';
import aiConversationsRoutes from './ai-conversations';
import aiEvalRoutes from './ai-eval';
import aiGenerationsRoutes from './ai-generations';
import aiHttpToolsRoutes from './ai-http-tools';
import aiKnowledgeRoutes from './ai-knowledge';
import aiModelsRoutes from './ai-models';
import aiSettingsRoutes from './ai-settings';
import aiPromptTemplatesRoutes from './ai-prompt-templates';
import aiProvidersRoutes from './ai-providers';
import aiPublicRoutes from './ai-public';
import aiUsageRoutes from './ai-usage';
import userAiConfigRoutes from './user-ai-config';

export default defineRouteDomain({
  name: 'ai',
  mounts: () => [
    [aiProviderContract.basePath, aiProvidersRoutes, { feature: 'ai' }],
    [aiChatModelContract.basePath, aiModelsRoutes, { feature: 'ai' }],
    [aiSettingsContract.basePath, aiSettingsRoutes, { feature: 'ai' }],
    // 对话根路径挂载三个路由器：扩展能力 → 基础 CRUD → SSE 流式对话，顺序是语义的一部分
    [aiConversationContract.basePath, aiConversationExtrasRoutes, { feature: 'ai' }],
    [aiPublicContract.basePath, aiPublicRoutes],
    [aiKnowledgeBaseContract.basePath, aiKnowledgeRoutes, { feature: 'ai' }],
    [aiAgentContract.basePath, aiAgentsRoutes, { feature: 'ai' }],
    [aiGenerationContract.basePath, aiGenerationsRoutes, { feature: 'ai' }],
    [aiHttpToolContract.basePath, aiHttpToolsRoutes, { feature: 'ai' }],
    [aiEvalContract.basePath, aiEvalRoutes, { feature: 'ai' }],
    [aiArenaContract.basePath, aiArenaRoutes, { feature: 'ai' }],
    [aiAuditContract.basePath, aiAuditRoutes, { feature: 'ai' }],
    [aiConversationContract.basePath, aiConversationsRoutes, { feature: 'ai' }],
    [aiConversationContract.basePath, aiChatRoutes, { feature: 'ai' }],
    [userAiConfigContract.basePath, userAiConfigRoutes, { feature: 'ai' }],
    [aiPromptTemplateContract.basePath, aiPromptTemplatesRoutes, { feature: 'ai' }],
    [aiUsageContract.basePath, aiUsageRoutes, { feature: 'ai' }],
  ],
});
