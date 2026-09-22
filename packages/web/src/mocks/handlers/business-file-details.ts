import { fillPath } from '@zenith/shared/core';
import { businessFileContract } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { currentMockSession } from '@/mocks/utils/auth';
import { notFound } from '@/mocks/utils/handlers';
import { canReadBusinessChainFixtures, mockBusinessAttachments } from './entity-business-chains';

export const businessFileDetailHandlers = [
  mock(businessFileContract.managedDetail, ({ params, request, ok }) => {
    const session = currentMockSession(request);
    const attachment = session && canReadBusinessChainFixtures(session)
      ? mockBusinessAttachments().find((row) => row.attachment.fileId === params.fileId)?.attachment : undefined;
    if (!attachment) return notFound('附件不存在', { status: 404 });
    return ok({ ...attachment.file, directUrl: null, createdAt: attachment.createdAt,
      url: fillPath(businessFileContract.managedContent.fullPath, { fileId: params.fileId }) });
  }),
  mock(businessFileContract.managedContent, ({ params, request }) => {
    const session = currentMockSession(request);
    const attachment = session && canReadBusinessChainFixtures(session)
      ? mockBusinessAttachments().find((row) => row.attachment.fileId === params.fileId)?.attachment : undefined;
    if (!attachment) return notFound('附件不存在', { status: 404 });
    // Demo uploads may provide a local Blob/data URL. Never forward an authenticated request to a remote URL.
    if (attachment.file.url.startsWith('blob:') || attachment.file.url.startsWith('data:')) return fetch(attachment.file.url);
    return notFound('演示附件没有本地文件内容', { status: 404 });
  }),
];
