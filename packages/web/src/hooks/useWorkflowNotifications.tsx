/**
 * 工作流实时通知：WebSocket 事件消费 + 待办数角标
 *
 * - `usePendingApprovalCount`：待我审批总数（菜单角标），WS 失联时靠轮询兜底
 * - `useWorkflowRealtime`：消费 `workflow:taskCreated / taskFinished / instanceFinished`
 *   推送，失效相关 TanStack Query 缓存并对新待办弹出提醒（挂载于 AdminLayout，一处生效）
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Notification } from '@douyinfe/semi-ui';
import type { WsMessage } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';
import { useWebSocket } from '@/hooks/useWebSocket';

export const workflowPendingCountKey = ['workflow', 'tasks', 'pending-count'] as const;

/** 待我审批总数（角标）。enabled=false 时不请求（如用户无待办菜单权限） */
export function usePendingApprovalCount(enabled: boolean) {
  return useQuery({
    queryKey: workflowPendingCountKey,
    queryFn: () =>
      request.get<{ count: number }>('/api/workflows/instances/pending-mine/count', { silent: true })
        .then(unwrap)
        .then((d) => d.count),
    enabled,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

/** 消费工作流 WS 事件：刷新待办角标与列表缓存，新待办弹出提醒（点击跳转处理） */
export function useWorkflowRealtime() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const handler = useCallback((msg: WsMessage) => {
    if (msg.type === 'workflow:taskCreated') {
      void queryClient.invalidateQueries({ queryKey: workflowPendingCountKey });
      void queryClient.invalidateQueries({ queryKey: ['workflow', 'tasks'] });
      const { instanceId, taskId, instanceTitle, nodeName } = msg.payload;
      const notifyId = `workflow-task-${taskId}`;
      Notification.info({
        id: notifyId,
        title: '新的审批待办',
        content: (
          <span
            style={{ cursor: 'pointer' }}
            role="link"
            tabIndex={0}
            onClick={() => {
              Notification.close(notifyId);
              navigate(`/workflow/pending?instanceId=${instanceId}&taskId=${taskId}`);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                Notification.close(notifyId);
                navigate(`/workflow/pending?instanceId=${instanceId}&taskId=${taskId}`);
              }
            }}
          >
            「{instanceTitle}」等待你处理（节点：{nodeName}），点击查看
          </span>
        ),
        duration: 5,
        position: 'topRight',
      });
    } else if (msg.type === 'workflow:taskFinished') {
      // 自己的任务被超时自动处理/或签抢占/管理员改派等场景，同步刷新待办
      void queryClient.invalidateQueries({ queryKey: workflowPendingCountKey });
      void queryClient.invalidateQueries({ queryKey: ['workflow', 'tasks'] });
    } else if (msg.type === 'workflow:instanceFinished') {
      // 发起人视角：申请结束（通过/驳回/撤回），刷新我的申请/抄送/详情等全量工作流缓存
      void queryClient.invalidateQueries({ queryKey: ['workflow'] });
    }
  }, [queryClient, navigate]);
  useWebSocket(handler);
}
