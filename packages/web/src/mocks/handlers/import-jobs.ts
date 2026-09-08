import { importJobContract } from '@zenith/shared/tasks';
import type { ImportEntityMeta } from '@zenith/shared/tasks';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '../utils/date';

const entities: ImportEntityMeta[] = [
  {
    entity: 'member.members',
    title: '会员',
    module: '会员中心',
    description: '批量导入前台会员账号，自动初始化积分与钱包账户；手机号/邮箱/用户名全局唯一',
    maxRows: 10000,
    requiresContext: false,
    columns: [
      { key: 'nickname', header: '昵称', required: true, example: '张三' },
      { key: 'phone', header: '手机号', example: '13800001111' },
      { key: 'email', header: '邮箱' },
      { key: 'username', header: '用户名' },
      { key: 'password', header: '初始密码' },
      { key: 'level', header: '等级名称' },
      { key: 'status', header: '状态', enumValues: ['正常', '未激活', '已封禁'] },
      { key: 'remark', header: '备注' },
    ],
  },
  {
    entity: 'identity.users',
    title: '用户',
    module: '用户管理',
    description: '批量导入后台用户，支持部门/岗位/角色编码关联；密码按平台密码策略校验',
    maxRows: 10000,
    requiresContext: false,
    columns: [
      { key: 'username', header: '用户名', required: true },
      { key: 'nickname', header: '昵称', required: true },
      { key: 'email', header: '邮箱' },
      { key: 'password', header: '密码', required: true },
      { key: 'departmentCode', header: '部门编码' },
      { key: 'positionCodes', header: '岗位编码' },
      { key: 'roleCodes', header: '角色编码' },
      { key: 'status', header: '状态', enumValues: ['enabled', 'disabled'] },
    ],
  },
  {
    entity: 'iot.devices',
    title: 'IoT 设备',
    module: 'IoT 设备',
    description: '批量注册设备：SN 留空自动生成，接入密钥自动分配',
    maxRows: 10000,
    requiresContext: false,
    columns: [
      { key: 'name', header: '设备名称', required: true },
      { key: 'productName', header: '产品名称', required: true },
      { key: 'sn', header: 'SN' },
      { key: 'firmwareVersion', header: '固件版本' },
      { key: 'groupNames', header: '分组名称' },
      { key: 'status', header: '状态', enumValues: ['enabled', 'disabled'] },
      { key: 'remark', header: '备注' },
    ],
  },
  {
    entity: 'platform.dict-items',
    title: '字典项',
    module: '系统设置',
    description: '按字典编码批量补充字典项，同字典内项值唯一',
    maxRows: 10000,
    requiresContext: false,
    columns: [
      { key: 'dictCode', header: '字典编码', required: true },
      { key: 'label', header: '项标签', required: true },
      { key: 'value', header: '项值', required: true },
      { key: 'sort', header: '排序' },
      { key: 'status', header: '状态', enumValues: ['enabled', 'disabled'] },
      { key: 'remark', header: '备注' },
    ],
  },
  {
    entity: 'cms.contents',
    title: 'CMS 内容',
    module: 'CMS内容管理',
    description: '需在 CMS 内容管理页选择站点/栏目后导入，逐行创建草稿内容',
    maxRows: 10000,
    requiresContext: true,
    columns: [
      { key: 'title', header: '标题', required: true },
      { key: 'summary', header: '摘要' },
      { key: 'body', header: '正文' },
    ],
  },
];

let nextImportTaskId = 9000;

export const importJobsHandlers = [
  mock(importJobContract.entities, ({ ok }) => ok(entities)),
  mock(importJobContract.submit, ({ ok }) => {
    const now = mockDateTime();
    const id = nextImportTaskId++;
    return ok({
      id, taskType: 'data-import', title: '会员导入（demo.xlsx）', module: '导入中心',
      status: 'success', payload: {}, totalCount: 3, processedCount: 3, failedCount: 1,
      progressNote: '成功 2 / 失败 1（共 3 行）', result: { total: 3, succeeded: 2, failed: 1 },
      errorMessage: null, cancelRequested: false, attempts: 1, maxAttempts: 1, retryDelayMs: 5000, nextRunAt: null,
      createdBy: 1, createdByName: '管理员', tenantId: null, traceId: null,
      startedAt: now, completedAt: now, createdAt: now, updatedAt: now,
    }, '导入任务已提交，可在任务中心查看进度与行级明细');
  }),
];
