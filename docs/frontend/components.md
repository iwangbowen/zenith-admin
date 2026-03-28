# 公共组件指南

本页列出 `packages/web/src/components/` 中的公共组件，说明其用途与使用方式。所有新页面应优先使用这些组件，保持全站交互一致性。

---

## SearchToolbar

搜索工具栏组件，用于所有 CRUD 列表页面的顶部筛选区域。采用左右分栏布局：左侧为搜索条件，右侧为操作按钮。

### Props

| Prop | 类型 | 说明 |
|------|------|------|
| `left` | `ReactNode` | 左侧内容（搜索输入框、下拉筛选、查询/重置按钮），自动用 `<Space wrap>` 包裹 |
| `right` | `ReactNode` | 右侧内容（新增等操作按钮），不自动包裹 |
| `className` | `string` | 附加 CSS 类名，应用到外层容器 |
| `children` | `ReactNode` | 工具栏下方的附加内容（如提示文字） |

### 使用示例

```tsx
import { SearchToolbar } from '../../components/SearchToolbar';
import { Input, Button, Select } from '@douyinfe/semi-ui';
import { Search, RotateCcw, Plus } from 'lucide-react';

<SearchToolbar
  left={<>
    <Input
      prefix={<Search size={14} />}
      placeholder="请输入名称"
      value={keyword}
      onChange={setKeyword}
      showClear
      style={{ width: 200 }}
    />
    <Select
      placeholder="请选择状态"
      value={status}
      onChange={(v) => setStatus(v as string)}
      allowClear
      style={{ width: 120 }}
    >
      <Select.Option value="active">启用</Select.Option>
      <Select.Option value="inactive">禁用</Select.Option>
    </Select>
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  </>}
  right={
    <Button type="secondary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  }
/>
```

### 注意事项

- 按钮文案统一为**「查询」「重置」「新增」**
- `left` 内的元素会自动换行（`wrap`），响应式友好
- 右侧操作按钮不自动包裹，由调用方决定是否使用 `<Space>`

---

## RegionSelect

省市区三级联动选择组件，基于 Semi Design Cascader 封装，数据来源为后端行政区划接口，按需动态加载。

**文件位置**：`packages/web/src/components/RegionSelect.tsx`

### 功能特点

- 支持国家级 → 省 → 市 → 区 → 街道/乡镇 五级行政区划
- 动态懒加载：展开到哪一级才请求该级数据
- 返回所选区划的完整 code 路径

### 使用示例

```tsx
import { RegionSelect } from '../../components/RegionSelect';

<RegionSelect
  value={regionCodes}
  onChange={(codes) => setRegionCodes(codes as string[])}
  placeholder="请选择省市区"
  style={{ width: 280 }}
/>
```

此组件已在用户管理的「省市区」字段使用，也可在任何需要行政区划选择的表单中复用。

---

## 富文本编辑器（wangEditor）

**使用场景**：仅用于**通知公告**的内容编辑，其他场景不建议使用富文本。

通知公告编辑页使用 [wangEditor](https://www.wangeditor.com/) 作为富文本编辑器，支持：

- 文字格式化（粗体、颜色、字号等）
- 图片上传（通过 `POST /api/files/upload` 上传，自动插入编辑器）
- 编辑器上传请求携带 `Authorization: Bearer <token>` 头

**图片上传集成**：编辑器配置了自定义上传函数，上传成功后将返回的 URL 插入到编辑器内容中。相关配置在 `packages/web/src/pages/system/notices/` 的通知编辑组件中实现。

---

## DiffTable（操作日志变更对比）

**文件位置**：`packages/web/src/pages/system/operation-logs/`

用于在操作日志「详情」弹窗中展示**变更前后的实体字段对比**，纯展示组件，无需手动维护。

### 渲染规则

- 每行代表一个字段，列出「字段名 / 变更前 / 变更后」
- 有差异的行高亮显示（黄色背景）
- `DELETE` 操作：只有 `beforeData`，展示被删除前的数据快照
- `PUT` 操作：同时有 `beforeData` 和 `afterData`，展示完整字段变更对比

> 这是只读组件，不需要主动维护。如果新的路由需要支持操作日志 Diff，请参考 [操作日志与变更记录](/backend/audit-log-changes) 中的接入说明。
