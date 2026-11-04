import { hasPermission } from '../../../../lib/context';
import { listAsyncTasks } from '../../../tasks/public/queries';
import type { GlobalSearchAdapter } from '../types';
import { result } from '../helpers';

export const asyncTaskSearchAdapter: GlobalSearchAdapter = {
  type: 'async-task',
  permissions: ['system:async-task:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('system:async-task:list'))) return [];
    const page = await listAsyncTasks({ page: 1, pageSize: limit, keyword: q });
    return page.list.map((task) => result({
      type: 'async-task',
      id: String(task.id),
      title: task.title,
      subtitle: [task.taskType, task.status].filter(Boolean).join(' · '),
      description: task.createdByName,
      icon: 'ListChecks',
      route: `/system/task-center?taskId=${task.id}`,
      highlights: [{ field: 'title', text: task.title }],
    }));
  },
};
