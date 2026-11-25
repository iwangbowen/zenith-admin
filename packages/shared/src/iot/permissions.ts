import { definePermissions } from '../core/permissions';

/**
 * iot 域权限码注册表：code → 权限标题 / 所属页面（菜单 name）。
 * 操作权限只存在于本注册表；契约操作 / 路由门禁 / 前端按钮以 `Permission` 类型引用。
 * `uiOnly` = 服务端没有任何接口检查该码（纯前端门控或待清理）。
 */
export const IOT_PERMISSIONS = definePermissions({
  'iot:dashboard:view': { label: '查询', menu: 'IotDashboard' },
  'iot:product:list': { label: '查询', menu: 'IotProducts' },
  'iot:product:create': { label: '新增产品', menu: 'IotProducts' },
  'iot:product:update': { label: '编辑产品', menu: 'IotProducts' },
  'iot:product:delete': { label: '删除产品', menu: 'IotProducts' },
  'iot:device:list': { label: '查询', menu: ['IotDevices', 'IotMap'] },
  'iot:device:create': { label: '注册设备', menu: 'IotDevices' },
  'iot:device:update': { label: '编辑设备', menu: 'IotDevices' },
  'iot:device:delete': { label: '删除设备', menu: 'IotDevices' },
  'iot:telemetry:view': { label: '遥测查看', menu: 'IotDevices' },
  'iot:command:send': { label: '指令下发', menu: 'IotDevices' },
  'iot:group:manage': { label: '分组管理', menu: 'IotDevices' },
  'iot:device:batch': { label: '批量操作', menu: 'IotDevices' },
  'iot:device:import': { label: '导入设备', menu: 'IotDevices' },
  'iot:alarm:list': { label: '查询', menu: 'IotAlarms' },
  'iot:alarm:resolve': { label: '处理告警', menu: 'IotAlarms' },
  'iot:alarm:rule:create': { label: '新增规则', menu: 'IotAlarms' },
  'iot:alarm:rule:update': { label: '编辑规则', menu: 'IotAlarms' },
  'iot:alarm:rule:delete': { label: '删除规则', menu: 'IotAlarms' },
  'iot:ota:list': { label: '查询', menu: 'IotOta' },
  'iot:ota:firmware:manage': { label: '固件管理', menu: 'IotOta' },
  'iot:ota:task:create': { label: '创建升级任务', menu: 'IotOta' },
  'iot:automation:list': { label: '查询', menu: 'IotAutomations' },
  'iot:automation:create': { label: '新增联动', menu: 'IotAutomations' },
  'iot:automation:update': { label: '编辑联动', menu: 'IotAutomations' },
  'iot:automation:delete': { label: '删除联动', menu: 'IotAutomations' },
  'iot:forward:list': { label: '查询', menu: 'IotForwards' },
  'iot:forward:create': { label: '新增规则', menu: 'IotForwards' },
  'iot:forward:update': { label: '编辑规则', menu: 'IotForwards' },
  'iot:forward:delete': { label: '删除规则', menu: 'IotForwards' },
  'iot:schedule:list': { label: '查询', menu: 'IotSchedules' },
  'iot:schedule:create': { label: '新增计划', menu: 'IotSchedules' },
  'iot:schedule:update': { label: '编辑计划', menu: 'IotSchedules' },
  'iot:schedule:delete': { label: '删除计划', menu: 'IotSchedules' },
  'iot:register:manage': { label: '白名单与密钥管理', menu: 'IotRegister' },
});
