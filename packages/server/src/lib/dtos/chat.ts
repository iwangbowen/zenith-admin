/**
 * 聊天 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const ChatUserDTO = z
  .object({
    id: z.number().int(),
    nickname: z.string(),
    username: z.string(),
    avatar: z.string().nullable().optional(),
  })
  .openapi('ChatUser');

export const ChatGroupMemberDTO = z
  .object({
    id: z.number().int(),
    nickname: z.string(),
    username: z.string(),
    avatar: z.string().nullable().optional(),
    role: z.enum(['owner', 'member']),
  })
  .openapi('ChatGroupMember');

export const ChatLinkPreviewDTO = z
  .object({
    url: z.url(),
    title: z.string(),
    description: z.string().nullable(),
    siteName: z.string().nullable(),
    image: z.url().nullable(),
    favicon: z.url().nullable(),
  })
  .strict()
  .openapi('ChatLinkPreview');

export const ChatAssetMetaDTO = z
  .object({
    kind: z.enum(['image', 'file', 'voice']),
    name: z.string(),
    size: z.number().int(),
    mimeType: z.string().nullable(),
    extension: z.string().nullable(),
    fileId: z.number().int().nullable().optional(),
    width: z.number().int().nullable().optional(),
    height: z.number().int().nullable().optional(),
    thumbnailUrl: z.string().max(2048).nullable().optional(),
    duration: z.number().nullable().optional(),
  })
  .strict()
  .openapi('ChatAssetMeta');

export const ChatMentionDTO = z
  .object({
    userId: z.number().int(),
    nickname: z.string(),
  })
  .strict()
  .openapi('ChatMention');

export const ChatAnnouncementHistoryDTO = z
  .object({
    announcement: z.string().nullable(),
    operatorName: z.string().nullable(),
  })
  .strict()
  .openapi('ChatAnnouncementHistory');

export const ChatForwardedItemDTO = z
  .object({
    senderName: z.string().nullable(),
    type: z.enum(['text', 'image', 'file', 'system', 'forward', 'vote', 'voice', 'card']),
    content: z.string(),
    createdAt: z.string(),
    asset: ChatAssetMetaDTO.nullable().optional(),
  })
  .openapi('ChatForwardedItem');

export const ChatCardFieldDTO = z
  .object({ label: z.string(), value: z.string() })
  .openapi('ChatCardField');

export const ChatCardActionDTO = z
  .object({
    key: z.string(),
    label: z.string(),
    theme: z.enum(['primary', 'secondary', 'danger', 'tertiary']).optional(),
    action: z.enum(['workflow:approve', 'workflow:reject', 'link', 'none']),
    taskId: z.number().int().nullable().optional(),
    url: z.string().nullable().optional(),
    requireComment: z.boolean().optional(),
  })
  .openapi('ChatCardAction');

export const ChatCardDTO = z
  .object({
    title: z.string(),
    text: z.string().nullable().optional(),
    fields: z.array(ChatCardFieldDTO).nullable().optional(),
    actions: z.array(ChatCardActionDTO).nullable().optional(),
    source: z.string().nullable().optional(),
    status: z.enum(['pending', 'done']).nullable().optional(),
    statusText: z.string().nullable().optional(),
  })
  .openapi('ChatCard');

export const ChatBotMetaDTO = z
  .object({ name: z.string(), avatar: z.string().nullable().optional() })
  .openapi('ChatBotMeta');

export const ChatVoteOptionDTO = z
  .object({
    id: z.string(),
    label: z.string(),
  })
  .openapi('ChatVoteOption');

export const ChatVoteRecordDTO = z
  .object({
    userId: z.number().int(),
    optionIds: z.array(z.string()),
    nickname: z.string(),
  })
  .openapi('ChatVoteRecord');

export const ChatVoteDataDTO = z
  .object({
    question: z.string(),
    options: z.array(ChatVoteOptionDTO),
    isMultiple: z.boolean(),
    isAnonymous: z.boolean(),
    expireAt: z.string().nullable(),
    votes: z.array(ChatVoteRecordDTO),
    isClosed: z.boolean(),
  })
  .openapi('ChatVoteData');

export const ChatMessageExtraDTO = z
  .object({
    asset: ChatAssetMetaDTO.nullable().optional(),
    linkPreview: ChatLinkPreviewDTO.nullable().optional(),
    mentions: z.array(ChatMentionDTO).nullable().optional(),
    isFavorited: z.boolean().optional(),
    isPinned: z.boolean().optional(),
    announcementHistory: ChatAnnouncementHistoryDTO.nullable().optional(),
    forwardedMessages: z.array(ChatForwardedItemDTO).nullable().optional(),
    forwardSourceConvName: z.string().nullable().optional(),
    hiddenFor: z.array(z.number().int()).nullable().optional(),
    voteData: ChatVoteDataDTO.nullable().optional(),
    card: ChatCardDTO.nullable().optional(),
    bot: ChatBotMetaDTO.nullable().optional(),
  })
  .strict()
  .openapi('ChatMessageExtra');

export const ChatReactionGroupDTO = z
  .object({
    emoji: z.string(),
    count: z.number().int(),
    userIds: z.array(z.number().int()),
  })
  .openapi('ChatReactionGroup');

export const ChatMessageDTO = z
  .object({
    id: z.number().int().openapi({ example: 1 }),
    conversationId: z.number().int(),
    senderId: z.number().int().nullable(),
    senderName: z.string().nullable(),
    senderAvatar: z.string().nullable().optional(),
    type: z.enum(['text', 'image', 'file', 'system', 'forward', 'vote', 'voice', 'card']),
    content: z.string(),
    replyToId: z.number().int().nullable().optional(),
    isRecalled: z.boolean(),
    isEdited: z.boolean(),
    extra: ChatMessageExtraDTO.nullable().optional(),
    reactions: z.array(ChatReactionGroupDTO).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ChatMessage');

export const ChatMessageSearchItemDTO = z
  .object({
    message: ChatMessageDTO,
    snippet: z.string(),
  })
  .openapi('ChatMessageSearchItem');

export const ChatMessageContextDTO = z
  .object({
    list: z.array(ChatMessageDTO),
    anchorMessageId: z.number().int(),
    hasBefore: z.boolean(),
    hasAfter: z.boolean(),
  })
  .openapi('ChatMessageContext');

export const ChatConversationDTO = z
  .object({
    id: z.number().int(),
    type: z.enum(['direct', 'group']),
    name: z.string().nullable().optional(),
    announcement: z.string().nullable().optional(),
    targetUser: z
      .object({ id: z.number().int(), nickname: z.string(), avatar: z.string().nullable().optional() })
      .nullable()
      .optional(),
    lastMessage: ChatMessageDTO.nullable().optional(),
    unreadCount: z.number().int(),
    isPinned: z.boolean(),
    isStarred: z.boolean(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ChatConversation');

export const ChatReadStateDTO = z
  .object({
    userId: z.number().int(),
    nickname: z.string(),
    avatar: z.string().nullable(),
    lastReadAt: z.string().nullable(),
  })
  .openapi('ChatReadState');

export const ChatPresenceDTO = z
  .object({
    userId: z.number().int(),
    online: z.boolean(),
    lastSeen: z.string().nullable(),
  })
  .openapi('ChatPresence');

export const ChatWebhookDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    avatar: z.string().nullable(),
    description: z.string().nullable(),
    conversationId: z.number().int(),
    conversationName: z.string().nullable(),
    enabled: z.boolean(),
    webhookUrl: z.string(),
    token: z.string(),
    lastUsedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ChatWebhook');
