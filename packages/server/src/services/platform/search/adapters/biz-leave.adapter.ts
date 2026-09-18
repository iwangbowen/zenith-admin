import { listBizLeaves } from '../../../biz-demo/biz-leave.service';
import type { GlobalSearchAdapter } from '../types';
import { result } from '../helpers';

export const bizLeaveSearchAdapter: GlobalSearchAdapter = {
  type: 'biz-leave',
  permissions: 'authenticated',
  async search({ q, limit }) {
    const page = await listBizLeaves({ page: 1, pageSize: limit, keyword: q });
    return page.list.map((leave) => result({
      type: 'biz-leave',
      id: String(leave.id),
      title: leave.reason?.slice(0, 160) || `${leave.leaveType} 请假单`,
      subtitle: [leave.leaveType, leave.startDate, leave.endDate].filter(Boolean).join(' · '),
      description: leave.status,
      icon: 'CalendarDays',
      route: `/biz/leaves?keyword=${encodeURIComponent(leave.reason ?? leave.leaveType)}`,
      highlights: leave.reason ? [{ field: 'title', text: leave.reason.slice(0, 240) }] : [],
    }));
  },
};

