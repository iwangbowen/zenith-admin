/** pg-boss job IDs are unique even for standard queues; singletonKey alone is not. */
export function asyncTaskDispatchOptions(task: { id: number; dispatchToken: string }) {
  return { id: task.dispatchToken, singletonKey: `async-task-${task.id}`, retryLimit: 0, retentionSeconds: 60 * 60 * 24 };
}
export function dispatchNeedsReplacement(state: string | null): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}
