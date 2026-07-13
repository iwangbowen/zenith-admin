# 权限与范围控制

工作流权限由三层组成：流程定义的发起范围、后台菜单/按钮权限点、实例详情的数据可见性。

## 发起范围

流程设计器基础信息中配置发起范围。

| 范围 | 说明 |
| --- | --- |
| 全部人员 | 所有人可发起 |
| 指定用户 | 仅选中用户可发起 |
| 指定部门 | 仅选中部门成员可发起 |
| 指定角色 | 仅拥有选中角色的用户可发起 |

发起工作台只展示当前用户可发起的已发布流程。后端发起接口也会再次校验。

## 菜单与功能权限

### 定义资产

| 权限点 | 说明 |
| --- | --- |
| `workflow:definition:list` | 流程定义、分类、模板、自动化读取 |
| `workflow:definition:create` | 新建定义、复制定义、从模板创建 |
| `workflow:definition:edit` | 编辑定义、分类、模板、自动化 |
| `workflow:definition:delete` | 删除定义 |
| `workflow:definition:publish` | 发布、禁用、启用定义 |
| `workflow:form:list` | 表单库列表 |
| `workflow:form:create` | 新建表单 |
| `workflow:form:edit` | 编辑、复制表单 |
| `workflow:form:delete` | 删除表单 |

### 发起与任务

| 权限点 | 说明 |
| --- | --- |
| `workflow:instance:create` | 发起工作台、我的申请、草稿、撤回、重新提交、催办 |
| `workflow:instance:list` | 抄送我的、评论、保存视图 |
| `workflow:task:handle` | 待我审批、我已办、审批处理、转办、委派、加签、减签、退回、协办、撤回已办、常用语 |

实例详情接口接受 `workflow:instance:list`、`workflow:task:handle`、`workflow:instance:monitor` 三者任一；持有 `monitor` 的管理员可查看全局实例详情，其余身份按参与关系过滤（见下文「实例详情可见性」）。

### 监控与运维

| 权限点 | 说明 |
| --- | --- |
| `workflow:instance:monitor` | 全局实例监控、数据分析、诊断、运行轨迹、Token 跳过、批量推进卡死实例、补偿工单查看 |
| `workflow:instance:cancel` | 取消流程、强制跳转、改派处理人、Token 重放等高危操作 |
| `workflow:instance:delete` | 删除流程实例 |
| `workflow:engine:operate` | 引擎恢复动作、实例迁移、补偿工单处理、挂起/恢复实例 |
| `workflow:task:handover` | 离职交接：批量移交某人名下待办并停用其审批代理 |
| `workflow:health:view` | 健康巡检页面 |

### 集成与计划

| 权限点 | 说明 |
| --- | --- |
| `workflow:event-subscription:view` | 查看事件订阅 |
| `workflow:event-subscription:create` | 创建事件订阅 |
| `workflow:event-subscription:edit` | 编辑、启停事件订阅 |
| `workflow:event-subscription:delete` | 删除事件订阅 |
| `workflow:event-delivery:view` | 查看投递记录 |
| `workflow:event-delivery:retry` | 重试、重放事件投递 |
| `workflow:trigger-execution:view` | 查看触发器执行记录 |
| `workflow:schedule:list` | 查看定时发起 |
| `workflow:schedule:create` | 创建定时发起 |
| `workflow:schedule:edit` | 编辑、立即执行定时发起 |
| `workflow:schedule:delete` | 删除定时发起 |
| `workflow:delegation:view` | 查看审批代理 |
| `workflow:delegation:manage` | 管理审批代理 |
| `workflow:datasource:list` | 查看远程数据源 |
| `workflow:datasource:create` | 创建远程数据源 |
| `workflow:datasource:update` | 更新远程数据源 |
| `workflow:datasource:delete` | 删除远程数据源 |
| `workflow:connector:list` | 查看连接器 |
| `workflow:connector:create` | 创建连接器 |
| `workflow:connector:update` | 更新连接器 |
| `workflow:connector:delete` | 删除连接器 |
| `workflow:connector:test` | 测试连接器 |

## 实例详情可见性

用户可查看以下实例：

| 身份 | 可见范围 |
| --- | --- |
| 发起人 | 自己发起的实例 |
| 任务处理人 | 包含自己任务的实例 |
| 抄送人 | 抄送给自己的实例 |
| 子流程相关人 | 与自己可见实例存在父子关系的实例 |
| 监控管理员 | 按租户和数据范围过滤后的全局实例 |

## 数据范围与租户

工作流数据带 `tenantId`。普通租户用户按当前租户过滤；平台超级管理员可跨租户查看或按当前查看租户过滤。

流程监控还叠加角色数据范围：

| 数据范围 | 说明 |
| --- | --- |
| 全部 | 查看全部实例 |
| 本部门及子部门 | 查看发起人属于本部门树的实例 |
| 本部门 | 仅本部门实例 |
| 自定义部门 | 指定部门范围 |
| 本人 | 仅本人发起或参与的实例 |

## 审批人解析范围

审批人解析遵循组织、角色、岗位、用户组和表单变量。角色审批人会按角色的管理范围过滤部门；部门范围默认包含子部门。表达式审批人在 `form` 和 `starter` 作用域中计算用户 ID。
