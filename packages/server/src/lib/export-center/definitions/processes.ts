import { listProcesses } from '../../../services/ops/processes.service';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

const columns: ExportColumn[] = [
  { key: 'pid', header: 'PID', width: 10, type: 'number' },
  { key: 'name', header: '进程名', width: 24 },
  { key: 'user', header: '用户', width: 14 },
  { key: 'status', header: '状态', width: 12 },
  { key: 'cpu', header: 'CPU%', width: 10 },
  { key: 'memoryPercent', header: '内存%', width: 10 },
  { key: 'memoryMB', header: '内存(MB)', width: 12 },
  { key: 'threads', header: '线程数', width: 10 },
  { key: 'nice', header: 'Nice', width: 8 },
  { key: 'priorityClass', header: '优先级类', width: 14 },
  { key: 'ports', header: '端口', width: 20 },
  { key: 'startTime', header: '启动时间', width: 22, type: 'datetime' },
  { key: 'command', header: '命令', width: 60 },
];

const toMemoryMB = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 100) / 100;

export const processesExportDefinition = defineExport({
  entity: 'system.processes',
  moduleName: '进程管理',
  filenamePrefix: '进程列表',
  sourcePath: '/system/processes',
  sheetName: '进程列表',
  permissions: { export: 'system:process:view' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async () => {
    const { processes } = await listProcesses();
    return processes.length;
  },
  streamRows: async () => {
    const { processes } = await listProcesses();
    return processes.map((p) => ({ ...p, memoryMB: toMemoryMB(p.memory) }));
  },
});
