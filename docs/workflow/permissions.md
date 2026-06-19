# 权限与范围控制

工作流模块的权限分为两个层面：流程定义的**发起人范围控制**（谁能发起流程），以及功能操作的**权限点控制**（谁能做什么操作）。

## 发起人范围控制

在流程设计器的「基础信息」步骤中，可配置「发起人范围」，限制哪些用户可以发起该流程。

### 范围类型

| 类型 | 说明 |
| --- | --- |
| 全部人员 | 所有人都可以发起（默认） |
| 指定用户 | 只有选中的用户才能发起 |
| 指定部门 | 只有选中部门的成员才能发起 |
| 指定角色 | 只有拥有选中角色的用户才能发起 |

### 配置方式

在流程设计器中配置：
1. 进入「基础信息」步骤
2. 找到「发起人范围」配置
3. 选择范围类型（全部/用户/部门/角色）
4. 如果选择了非「全部」，则勾选对应的具体用户/部门/角色

### 运行时校验

用户发起流程时，系统会自动校验当前用户是否在流程的发起人范围内：

- **全部人员**：直接通过
- **指定用户**：校验用户 ID 是否在列表中
- **指定部门**：校验用户所属部门 ID 是否在列表中
- **指定角色**：校验用户拥有的角色 ID 是否与列表中的角色匹配

如果不在范围内，系统会提示「当前流程不在你的可发起范围内」。

## 功能权限点

工作流模块涉及的权限点如下：

### 流程定义相关

| 权限点 | 说明 |
| --- | --- |
| `workflow:definition:list` | 查看流程定义列表（流程分类、流程自动化也复用此读权限） |
| `workflow:definition:create` | 创建流程定义 |
| `workflow:definition:edit` | 编辑流程定义（流程自动化的写操作也复用此权限） |
| `workflow:definition:delete` | 删除流程定义 |
| `workflow:definition:publish` | 发布/禁用流程定义 |

### 表单库相关

| 权限点 | 说明 |
| --- | --- |
| `workflow:form:list` | 查看表单库列表 |
| `workflow:form:create` | 创建表单 |
| `workflow:form:edit` | 编辑表单 |
| `workflow:form:delete` | 删除表单 |

### 流程实例相关

| 权限点 | 说明 |
| --- | --- |
| `workflow:instance:list` | 查看我的申请列表和实例详情 |
| `workflow:instance:create` | 发起流程申请（同时也是查看已发布流程列表的权限） |
| `workflow:instance:monitor` | 查看全局流程实例列表（管理员权限） |
| `workflow:instance:cancel` | 取消/终止流程实例（管理员） |
| `workflow:instance:delete` | 删除流程实例（管理员） |

### 任务相关

| 权限点 | 说明 |
| --- | --- |
| `workflow:task:handle` | 处理待审批任务（通过/驳回等），同时也是查看待我审批列表的权限 |

### 触发器与事件相关

| 权限点 | 说明 |
| --- | --- |
| `workflow:trigger-execution:view` | 查看触发器执行记录 |
| `workflow:event-subscription:view` | 查看事件订阅 |
| `workflow:event-subscription:create` | 创建事件订阅 |
| `workflow:event-subscription:edit` | 编辑事件订阅 |
| `workflow:event-subscription:delete` | 删除事件订阅 |
| `workflow:event-delivery:view` | 查看事件投递记录 |

## 权限配置建议

### 普通员工

建议分配权限：
- `workflow:instance:create` — 发起申请
- `workflow:instance:list` — 查看我的申请
- `workflow:task:handle` — 处理待我审批的任务

### 流程管理员

建议分配权限：
- `workflow:definition:*` — 管理流程定义
- `workflow:form:*` — 管理表单库
- `workflow:instance:monitor` — 监控全局流程实例
- `workflow:trigger-execution:view` — 查看触发器执行记录
- `workflow:event-subscription:*` — 管理事件订阅

### 系统管理员

通常拥有全部权限，可在角色管理中为管理员角色分配所有 `workflow:*` 权限。

## 数据权限（租户隔离）

系统支持多租户模式，流程定义和实例按租户隔离：

- 用户只能看到同租户下的流程定义和实例
- 租户管理员可以看到本租户下的所有数据
- 系统管理员（超级管理员）可以跨租户查看数据

## 实例查看权限

流程实例的查看遵循以下规则：

| 用户类型 | 可查看的实例 |
| --- | --- |
| 发起人 | 自己发起的实例 |
| 审批人 | 包含自己待处理/已处理任务的实例 |
| 管理员（`workflow:instance:monitor`） | 全局所有实例 |

在查看实例详情时，如果用户既不是发起人也不是该实例的审批人，系统会返回「无权查看」。
