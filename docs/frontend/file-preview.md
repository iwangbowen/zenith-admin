# 文件预览组件

`FilePreviewModal` 是全站统一的文件预览弹窗，支持图片、PDF、音频、视频和 Excel 电子表格五种格式。调用方只需传入文件元数据，无需自行判断格式或引入额外组件。

**文件位置**：`packages/web/src/components/FilePreviewModal/index.tsx`

---

## 支持的文件格式

| 格式 | MIME 类型 | 渲染方式 | 需要 `fileId` |
| --- | --- | --- | --- |
| 图片 | `image/*` | Semi Design `ImagePreview`（由调用方处理） | 否 |
| PDF | `application/pdf` | `@embedpdf/react-pdf-viewer`（`PDFPreviewPanel`） | 否 |
| 音频 | `audio/*` | Semi Design `AudioPlayer` | 否 |
| 视频 | `video/*` | Semi Design `VideoPlayer` | 否 |
| Excel | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | Univer 开源版只读渲染（`ExcelPreviewPanel`，懒加载） | **是** |

> **图片**不在 `FilePreviewModal` 内部渲染。遇到 `image/*` 时组件会立即调用 `onClose` 并回退，由调用方自行打开 `ImagePreview`。

---

## Props

| Prop | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileUrl` | `string` | ✅ | 文件访问 URL，通常为 `/api/files/{id}/content` |
| `fileId` | `number` | Excel 预览时必填 | 托管文件 ID，用于请求后端 `/sheet-preview` 接口 |
| `fileName` | `string` | 否 | 文件名，显示在标题栏；默认 `'文件'` |
| `mimeType` | `string \| null` | 否 | MIME 类型，决定走哪个渲染分支；为空时直接关闭 |
| `visible` | `boolean` | ✅ | 控制弹窗显示/隐藏 |
| `onClose` | `() => void` | ✅ | 关闭回调 |
| `onFallback` | `(url, name, mime) => void` | 否 | 遇到不支持格式时触发；不传则静默关闭 |

---

## 使用示例

### 基础用法

```tsx
import FilePreviewModal from '@/components/FilePreviewModal';

const [preview, setPreview] = useState<{
  id: number;
  url: string;
  name: string;
  mimeType: string;
} | null>(null);

// 触发预览
const handlePreview = (file: ManagedFile) => {
  setPreview({
    id: file.id,
    url: file.url,
    name: file.originalName,
    mimeType: file.mimeType ?? 'application/octet-stream',
  });
};

// 渲染
<FilePreviewModal
  fileUrl={preview?.url ?? ''}
  fileId={preview?.id}
  fileName={preview?.name}
  mimeType={preview?.mimeType}
  visible={!!preview}
  onClose={() => setPreview(null)}
/>
```

### 使用 `canPreviewFile` 控制按钮状态

```tsx
import { canPreviewFile } from '@/utils/file-utils';

// 在表格操作列中：
const isPreviewable = canPreviewFile(record.mimeType);

<Button
  theme="borderless"
  size="small"
  disabled={!isPreviewable}
  onClick={() => handlePreview(record)}
>
  预览
</Button>
```

`canPreviewFile` 覆盖全部五种可预览格式（image / audio / video / PDF / xlsx），调用方无需手动枚举 MIME 类型。

---

## 各格式实现细节

### PDF

通过 `fetchProtectedFile(fileUrl)` 携带 Bearer Token 下载 Blob，再以 `File` 对象喂给 `PDFPreviewPanel`（基于 `@embedpdf/react-pdf-viewer`）。支持页面缩放、适合页宽/页高等模式，弹窗高度占 88vh。

### 音频 / 视频

同样通过 `fetchProtectedFile` 下载 Blob，创建 `Object URL` 传给 Semi Design `AudioPlayer` / `VideoPlayer`，关闭时主动调用 `URL.revokeObjectURL` 释放内存。

### Excel（.xlsx）

Excel 预览分为**后端转换**和**前端渲染**两个阶段，后端零新依赖（复用项目内置 `exceljs`）：

#### 后端：xlsx → IWorkbookData

接口：`GET /api/files/{id}/sheet-preview`（需登录，`system:file:list` 权限）

- 从存储后端（本地 / OSS / S3 / COS 等）读取文件流
- 转为 `ArrayBuffer`，用 `exceljs.Workbook.xlsx.load()` 解析
- 将单元格值、基础样式（字体/颜色/对齐/边框/填充）、合并区域、行高列宽映射为 Univer `IWorkbookData` JSON
- 返回 `{ code: 0, data: IWorkbookData }`

**限制**（防止内存溢出）：

| 参数 | 上限 |
| --- | --- |
| 文件大小 | 10 MB |
| 工作表数量 | 20 张 |
| 单表行数 | 2000 行 |
| 单表列数 | 200 列 |
| 公式 | 显示缓存计算值，不重算 |
| 图表 / 条件格式 / 数据透视 | 不支持 |

**转换器文件**：`packages/server/src/lib/xlsx-to-univer.ts`

#### 前端：Univer 只读渲染

`FilePreviewModal` 通过 `request.get<IWorkbookData>('/api/files/{id}/sheet-preview')` 拉取数据后，**懒加载** `ExcelPreviewPanel`（`React.lazy`），避免 Univer 体积影响首屏。

`ExcelPreviewPanel`（`packages/web/src/components/ExcelPreviewPanel.tsx`）：

```text
createUniver({
  darkMode: isDark,            // 跟随应用暗色主题
  presets: [UniverSheetsCorePreset({
    header: false,             // 隐藏顶部 Header
    toolbar: false,            // 隐藏工具栏
    formulaBar: false,         // 隐藏公式栏
    contextMenu: false,        // 禁用右键菜单
    footer: { sheetBar: true, statisticBar: false, zoomSlider: true },
  })],
})
univerAPI.createWorkbook(data)
fWorkbook.setEditable(false)   // 设为只读，禁止编辑
```

组件卸载时调用 `univer.dispose()` 释放所有 Univer 实例资源，防止内存泄漏。

**依赖**（`packages/web`）：

```text
@univerjs/presets@0.25.0
@univerjs/preset-sheets-core@0.25.0
```

---

## 判断工具函数

`packages/web/src/utils/file-utils.tsx` 提供两个辅助函数：

```ts
/** 判断是否支持预览（覆盖 image / audio / video / PDF / xlsx） */
canPreviewFile(mimeType: string | null | undefined): boolean

/** 判断是否为 xlsx 表格（仅内部使用） */
isSpreadsheetFile(mimeType?: string | null): boolean
```

---

## 已接入的页面

| 页面 | 组件 | fileId 来源 |
| --- | --- | --- |
| 文件管理 | `FilesPage` | `ManagedFile.id` |
| 存储浏览 | `StorageFileBrowser` | `ManagedFile.id` |
| 文件附件 | `FileAttachment` | `AttachmentItem.file.id` |
| 消息中心 | `ChatPage` | `ChatAssetMeta.fileId`（发送时从 upload-one 响应写入） |

> 聊天页面的历史消息（`fileId` 为空）不支持 xlsx 在线预览，点击时不会打开弹窗。新发送的文件消息会自动携带 `fileId`，可正常预览。

---

## 新页面接入

只需三步：

1. 将文件数据存入状态，包含 `id / url / name / mimeType`
2. 在触发预览前用 `canPreviewFile(mimeType)` 判断是否显示预览入口
3. 渲染 `<FilePreviewModal fileId={id} fileUrl={url} fileName={name} mimeType={mime} visible={visible} onClose={onClose} />`

其余逻辑（格式分发、懒加载、token 认证、资源回收）均由组件内部处理。
