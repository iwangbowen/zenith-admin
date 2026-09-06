import { sessionContract } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
import { mockOnlineSessions } from '@/mocks/data/system';
import { includesKeyword } from '@/mocks/utils/filter';

export const sessionsHandlers = [
  // 在线用户列表
  mock(sessionContract.list, ({ query, ok, paginate }) => {
    const keyword = query.keyword ?? '';
    const list = mockOnlineSessions.filter((s) => {
      if (keyword && !includesKeyword(keyword, s.username, s.nickname, s.ip)) return false;
      return true;
    });
    return ok(paginate(list));
  }),

  // 强制指定用户所有会话下线（须先于 {tokenId} 注册，否则 "user" 会被当作 tokenId）
  mock(sessionContract.forceLogoutUser, ({ params, ok }) => {
    const removed = removeWhere(mockOnlineSessions, (s) => s.userId === params.id);
    return ok(null, `已强制下线 ${removed} 个会话`);
  }),

  // 强制下线（demo 模式仅从列表中移除）
  mock(sessionContract.forceLogout, ({ params, ok }) => {
    const index = mockOnlineSessions.findIndex((s) => s.tokenId === params.tokenId);
    if (index === -1) return notFound('会话不存在', { status: 404 });
    mockOnlineSessions.splice(index, 1);
    return ok(null, '已强制下线');
  }),
];
