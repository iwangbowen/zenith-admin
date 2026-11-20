/** 文件上传域的进程内计数；Prometheus 抓取时通过 collect 钩子导出。 */
const counters = {
  directStarted: 0,
  directCompleted: 0,
  directFailed: 0,
  directAborted: 0,
  directBytes: 0,
  quickUploadHits: 0,
  quickUploadMisses: 0,
};

export type FileUploadMetric =
  | 'directStarted'
  | 'directCompleted'
  | 'directFailed'
  | 'directAborted'
  | 'quickUploadHits'
  | 'quickUploadMisses';

export function recordFileUploadMetric(metric: FileUploadMetric, amount = 1): void {
  counters[metric] += amount;
}

export function recordDirectUploadBytes(bytes: number): void {
  if (Number.isFinite(bytes) && bytes > 0) counters.directBytes += bytes;
}

export function getFileUploadCounters(): Readonly<typeof counters> {
  return counters;
}
