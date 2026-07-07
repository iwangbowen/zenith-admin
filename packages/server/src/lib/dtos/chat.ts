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
    role: z.enum(['owner', 'admin', 'member']),
    mutedUntil: z.string().nullable().optional(),
  })
  .openapi('ChatGroupMember');

export const ChatOrgDataDTO = z
  .object({
    departments: z.array(z.object({
      id: z.number().int(),
      name: z.string(),
      parentId: z.number().int(),
    })),
    users: z.array(z.object({
      id: z.number().int(),
      nickname: z.string(),
      username: z.string(),
      avatar: z.string().nullable(),
      departmentId: z.number().int().nullable(),
    })),
  })
  .openapi('ChatOrgData');

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
    kind: z.enum(['image', 'file', 'voice', 'video']),
    name: z.string(),
    size: z.number().int(),
    mimeType: z.string().nullable(),
    extension: z.string().nullable(),
    fileId: z.string().uuid().nullable().optional(),
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
    type: z.enum(['text', 'image', 'file', 'system', 'forward', 'vote', 'voice', 'card', 'video']),
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
    instanceId: z.number().int().nullable().optional(),
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
    type: z.enum(['text', 'image', 'file', 'system', 'forward', 'vote', 'voice', 'card', 'video']),
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
    isArchived: z.boolean().optional(),
    muteAll: z.boolean().optional(),
    joinApproval: z.boolean().optional(),
    myRole: z.enum(['owner', 'admin', 'member']).optional(),
    myMutedUntil: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ChatConversation');

export const ChatQuickReplyDTO = z
  .object({
    id: z.number().int(),
    content: z.string(),
    sort: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ChatQuickReply');

export const ChatScheduledMessageDTO = z
  .object({
    id: z.number().int(),
    conversationId: z.number().int(),
    conversationName: z.string().nullable(),
    type: z.enum(['text', 'image', 'file', 'system', 'forward', 'vote', 'voice', 'card', 'video']),
    content: z.string(),
    extra: ChatMessageExtraDTO.nullable().optional(),
    scheduledAt: z.string(),
    status: z.enum(['pending', 'sent', 'canceled', 'failed']),
    failReason: z.string().nullable(),
    sentMessageId: z.number().int().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ChatScheduledMessage');

export const ChatCustomEmojiDTO = z
  .object({
    id: z.number().int(),
    url: z.string(),
    fileId: z.string().nullable(),
    name: z.string().nullable(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    createdAt: z.string(),
  })
  .openapi('ChatCustomEmoji');

export const ChatGroupInviteDTO = z
  .object({
    id: z.number().int(),
    conversationId: z.number().int(),
    token: z.string(),
    expiresAt: z.string().nullable(),
    maxUses: z.number().int().nullable(),
    usedCount: z.number().int(),
    enabled: z.boolean(),
    createdAt: z.string(),
  })
  .openapi('ChatGroupInvite');

export const ChatInviteInfoDTO = z
  .object({
    conversationId: z.number().int(),
    groupName: z.string().nullable(),
    memberCount: z.number().int(),
    joinApproval: z.boolean(),
    alreadyMember: z.boolean(),
  })
  .openapi('ChatInviteInfo');

export const ChatGroupJoinRequestDTO = z
  .object({
    id: z.number().int(),
    conversationId: z.number().int(),
    userId: z.number().int(),
    nickname: z.string(),
    avatar: z.string().nullable(),
    message: z.string().nullable(),
    status: z.enum(['pending', 'approved', 'rejected']),
    createdAt: z.string(),
  })
  .openapi('ChatGroupJoinRequest');

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

export const RtcIceServerDTO = z
  .object({
    urls: z.union([z.string(), z.array(z.string())]),
    username: z.string().optional(),
    credential: z.string().optional(),
  })
  .openapi('RtcIceServer');

export const RtcConfigDTO = z
  .object({
    iceServers: z.array(RtcIceServerDTO),
  })
  .openapi('RtcConfig');
