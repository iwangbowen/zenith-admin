/** 目录同步执行状态标签色（同步源页 / 同步日志页共用） */
export const DIRECTORY_SYNC_RUN_STATUS_TAG_COLOR: Record<string, 'green' | 'red' | 'orange' | 'blue' | 'grey'> = {
  success: 'green',
  partial: 'orange',
  failed: 'red',
  aborted: 'red',
  running: 'blue',
};