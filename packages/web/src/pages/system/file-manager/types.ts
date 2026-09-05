/**
 * 文件管理器页面内共享类型。
 *
 * FsEntry 等服务端实体类型的单一来源是 ops 契约（`@zenith/shared/ops`），
 * 此处仅 re-export + 定义页面私有的视图状态类型。
 */
export type { FsEntry, FsDirListing as DirListing, FsRootInfo as RootInfo } from '@zenith/shared/ops';
import type { FsEntry } from '@zenith/shared/ops';

export type ViewMode = 'list' | 'grid';
export type ClipOp = 'copy' | 'cut';

/** 列表排序状态（null = 默认：文件夹优先 + 名称升序） */
export type SortField = 'name' | 'size' | 'mtime';
export interface SortState { field: SortField; order: 'ascend' | 'descend' }

/** 同名冲突处理方式 */
export type ConflictResolution = 'overwrite' | 'skip' | 'keep-both';

/** 名称输入类弹窗（重命名/新建/移动/复制/压缩/chmod）的判别联合状态 */
export type FmDialogState =
  | { mode: 'rename'; entry: FsEntry; value: string }
  | { mode: 'newFile' | 'newDir'; value: string }
  | { mode: 'move' | 'copy'; entry: FsEntry; value: string }
  | { mode: 'compress'; selEntries: FsEntry[]; value: string }
  | { mode: 'chmod'; entry: FsEntry; value: string }
  | null;
