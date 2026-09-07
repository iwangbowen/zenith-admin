import { formatBytes } from '@zenith/shared/core';
import { DRIVE_NODE_TYPE_LABELS, type SendDriveNodeToChatInput } from '@zenith/shared/drive';
import { db } from '../../db';
import { driveSpaces } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { sendMessage } from '../chat/chat-messages.service';
import { ensureNodeRole } from './drive-access.service';
import { ensureDriveNodeExists, loadBreadcrumbs } from './drive-nodes.service';

/**
 * 网盘 × 站内协作：把文件 / 文件夹以卡片消息发到聊天会话。
 * 卡片只携带链接与元数据，不复制对象；收件人点开后仍按网盘 ACL 判定可见性（无权者可走访问申请）。
 * Wiki 侧的「插入网盘文件」同理只写入站内链接，因此不需要服务端参与。
 */
export async function sendDriveNodeToChat(nodeId: number, input: SendDriveNodeToChatInput): Promise<{ sent: number }> {
  const node = await ensureDriveNodeExists(nodeId);
  await ensureNodeRole(node, 'viewer', '没有该文件的访问权限');
  const [space] = await db.select({ name: driveSpaces.name }).from(driveSpaces).where(eq(driveSpaces.id, node.spaceId)).limit(1);
  const breadcrumbs = await loadBreadcrumbs(node);
  const location = [space?.name ?? '', ...breadcrumbs.map((b) => b.name)].filter(Boolean).join(' / ');
  const url = node.type === 'folder' ? `/drive?space=${node.spaceId}&folder=${node.id}` : `/drive?space=${node.spaceId}&node=${node.id}`;
  const note = input.note?.trim();
  const card = {
    title: node.name,
    text: note || `来自企业网盘的${DRIVE_NODE_TYPE_LABELS[node.type]}`,
    fields: [
      { label: '位置', value: location || '—' },
      ...(node.type === 'file' ? [{ label: '大小', value: formatBytes(node.size) }, { label: '版本', value: `v${node.currentVersion}` }] : []),
    ],
    actions: [{ key: 'open', label: node.type === 'folder' ? '打开文件夹' : '打开文件', action: 'link' as const, url, theme: 'primary' as const }],
    source: '企业网盘',
  };
  let sent = 0;
  for (const conversationId of [...new Set(input.conversationIds)]) {
    await sendMessage(conversationId, { type: 'card', content: `[网盘${DRIVE_NODE_TYPE_LABELS[node.type]}] ${node.name}`, extra: { card } });
    sent += 1;
  }
  return { sent };
}
