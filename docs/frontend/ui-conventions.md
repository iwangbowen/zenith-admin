# UI 规范

前端采用 **Semi Design** 作为组件库，并在页面结构与交互方式上保持统一。

## 组件与图标

- UI 组件统一使用 `@douyinfe/semi-ui`
- 图标统一使用 `lucide-react`
- 不引入 `@douyinfe/semi-icons`

## 列表页布局规范

所有 CRUD 列表页面采用无卡片（Cardless）设计方案。

### 搜索区与操作按钮

- 搜索条件与查询/重置按钮放在左侧
- 新增按钮放在右侧
- 通过 `flex` + `justify-content: space-between` 做左右布局
- 按钮文案统一为：`查询`、`重置`、`新增`

### 表格

- 表格必须带边框：`bordered`
- “操作”列必须右侧固定：`fixed: 'right'`

### 操作列按钮

- 使用纯文字无图标按钮
- `theme="borderless"`
- `size="small"`
- 删除按钮额外使用 `type="danger"`

## 时间格式规范

所有时间显示统一使用：`YYYY-MM-DD HH:mm:ss`

要求：

- 使用 `dayjs`
- 统一通过 `packages/web/src/utils/date.ts` 中的 `formatDateTime(date)` 处理
- 禁止在页面组件中直接使用原生 `toLocaleString()` 等方法

## 页面设计原则

- 信息层次清晰
- 列表页优先考虑高频操作效率
- 不过度装饰，保持后台系统应有的稳定感
- 新页面尽量沿用已有布局与交互节奏
