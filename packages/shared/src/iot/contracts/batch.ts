import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { iotBatchCommandSchema, iotBatchDesiredSchema } from '../validation';

/**
 * 批量操作：目标集在提交时展开（deviceIds ∪ groupId 成员），交给任务中心执行，
 * 响应即任务中心的任务记录（进度 / 重试 / 取消 / 行级明细均在任务中心查看）。
 */
export const iotBatchContract = defineContract('/api/iot/batch', {
  commands: op.post('/commands', { access: { permission: 'iot:device:batch' }, audit: '批量下发 IoT 指令', body: iotBatchCommandSchema, response: asyncTaskSchema, summary: '批量下发指令（任务中心执行，行级明细可见）' }),
  desired: op.post('/desired', { access: { permission: 'iot:device:batch' }, audit: '批量设置 IoT 期望属性', body: iotBatchDesiredSchema, response: asyncTaskSchema, summary: '批量设置期望属性（任务中心执行）' }),
}, { auditModule: 'IoT 设备', tags: ['IoT 设备'], feature: 'iot' });
