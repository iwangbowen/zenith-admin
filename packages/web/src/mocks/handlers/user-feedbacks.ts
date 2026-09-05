import { userFeedbackContract, type UserFeedback } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
import { mockUserFeedbacks, getNextUserFeedbackId } from '../data/user-feedbacks';
import { mockDateTime } from '../utils/date';

export const userFeedbacksHandlers = [
  // 分页列表 + 筛选
  mock(userFeedbackContract.list, ({ query, ok, paginate }) => {
    const { keyword, category, status, startTime, endTime } = query;
    let list = [...mockUserFeedbacks].sort((a, b) => b.id - a.id);
    if (keyword) list = list.filter((f) => (f.content ?? '').includes(keyword));
    if (category) list = list.filter((f) => f.category === category);
    if (status) list = list.filter((f) => f.status === status);
    if (startTime) list = list.filter((f) => f.createdAt >= startTime);
    if (endTime) list = list.filter((f) => f.createdAt <= `${endTime} 23:59:59`);
    return ok(paginate(list));
  }),

  // 提交反馈
  mock(userFeedbackContract.submit, ({ body, ok }) => {
    const now = mockDateTime();
    const newFeedback: UserFeedback = {
      id: getNextUserFeedbackId(),
      userId: 1,
      userNickname: '管理员',
      score: body.score ?? null,
      category: body.category,
      content: body.content?.trim() || null,
      pagePath: body.pagePath ?? null,
      replayId: body.replayId ?? null,
      status: 'pending',
      handleRemark: null,
      handledBy: null,
      handlerNickname: null,
      handledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    mockUserFeedbacks.push(newFeedback);
    return ok(newFeedback, '感谢您的反馈');
  }),

  // 处理反馈
  mock(userFeedbackContract.handle, ({ params, body, ok }) => {
    const feedback = mockUserFeedbacks.find((f) => f.id === params.id);
    if (!feedback) {
      return notFound('反馈不存在', { status: 404 });
    }
    const now = mockDateTime();
    const handled = body.status !== 'pending';
    Object.assign(feedback, {
      status: body.status,
      handleRemark: body.handleRemark?.trim() || null,
      handledBy: handled ? 1 : null,
      handlerNickname: handled ? '管理员' : null,
      handledAt: handled ? now : null,
      updatedAt: now,
    });
    return ok(feedback, '处理成功');
  }),

  // 批量删除（静态 /batch 早于动态 /{id}）
  mock(userFeedbackContract.removeBatch, ({ body, ok }) => {
    if (body.ids.length === 0) {
      return badRequest('请选择要删除的记录', { status: 400 });
    }
    const ids = new Set(body.ids);
    const deleted = removeWhere(mockUserFeedbacks, (f) => ids.has(f.id));
    return ok(null, `已删除 ${deleted} 条记录`);
  }),

  // 删除
  mock(userFeedbackContract.remove, ({ params, ok }) => {
    const idx = mockUserFeedbacks.findIndex((f) => f.id === params.id);
    if (idx === -1) {
      return notFound('反馈不存在', { status: 404 });
    }
    mockUserFeedbacks.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
