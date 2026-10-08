import { chatBotContract, chatContract, chatWebhookPublicContract } from '@zenith/shared/chat';
import { defineRouteDomain } from '../_kit';
import chatBotsRoutes from './chat-bots';
import chatPublicRoutes from './chat-public';
import chatRoutes from './chat';

export default defineRouteDomain({
  name: 'chat',
  licensing: { feature: 'chat' },
  mounts: () => [
    [chatWebhookPublicContract.basePath, chatPublicRoutes, { licenseExempt: 'Webhook 消息接收入口保留自身密钥鉴权' }],
    [chatContract.basePath, chatRoutes, { feature: 'chat' }],
    [chatBotContract.basePath, chatBotsRoutes, { feature: 'chat' }],
  ],
});
