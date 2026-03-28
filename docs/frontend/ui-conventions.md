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

## 弹窗表单

使用 Semi Design `Modal` + `Form` 组合处理新增/编辑弹窗。

```tsx
const [formApi, setFormApi] = useState<FormApi>();
const [visible, setVisible] = useState(false);
const [editing, setEditing] = useState<UserRecord | null>(null);

const handleOk = async () => {
  const values = await formApi?.validate();
  if (!values) return;
  // 提交逻辑...
};

<Modal
  title={editing ? '编辑用户' : '新增用户'}
  visible={visible}
  onOk={handleOk}
  onCancel={() => setVisible(false)}
>
  <Form getFormApi={setFormApi} initValues={editing ?? undefined}>
    <Form.Input field="username" label="用户名" rules={[{ required: true }]} />
  </Form>
</Modal>
```

- `getFormApi` 回调获取 `FormApi`，**禁止用 `any` 类型**
- 编辑时通过 `initValues` 回填表单

## 按钮权限控制

使用 `usePermission` hook 控制前端按钮级别的权限：

```tsx
import { usePermission } from '../../hooks/usePermission';

const { hasPermission } = usePermission();

{hasPermission('user:create') && (
  <Button onClick={openCreate}>新增</Button>
)}
```

权限标识符需与菜单管理中配置的按钮权限 `perms` 字段保持一致。

## 分页规范

分页统一使用 `Table` 内置 `pagination` 配置，不单独放置 `Pagination` 组件：

```tsx
<Table
  bordered
  dataSource={list}
  columns={columns}
  pagination={{
    currentPage: page,
    pageSize,
    total,
    showSizeChanger: true,
    pageSizeOpts: [10, 20, 50, 100],
    onChange: (p, size) => { setPage(p); setPageSize(size); },
  }}
/>
```

## 搜索区代码示例

```tsx
import { SearchToolbar } from '../../components/SearchToolbar';

<SearchToolbar
  left={<>
    <Input prefix={<Search size={14} />} placeholder="搜索..." showClear
      value={keyword} onChange={setKeyword} />
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  </>}
  right={<>
    <Button type="secondary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  </>}
/>
```

## 页面设计原则

- 信息层次清晰，高频操作易于触达
- 列表页优先考虑操作效率，不过度装饰
- 保持后台系统稳定感，新页面尽量沿用已有布局与交互节奏
- 表单验证错误信息使用 Semi Form 的 `rules` 属性声明式配置
