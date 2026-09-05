/**
 * 名称输入类弹窗（重命名/新建文件/新建文件夹/移动/复制/压缩/chmod 七种模式共用）。
 * 自持确认逻辑：名称校验 → 操作映射 → 提交 → Toast。
 */
import { Input, Toast, Typography } from '@douyinfe/semi-ui';
import type { UseMutationResult } from '@tanstack/react-query';
import AppModal from '@/components/AppModal';
import { useTerminalCompress, type TerminalFileOperation } from '@/hooks/queries/terminal-files';
import { dialogTitle, validateEntryName } from '../fs-utils';
import type { FmDialogState } from '../types';
import ChmodEditor from './ChmodEditor';

interface FmDialogsProps {
  readonly dialog: FmDialogState;
  readonly setDialog: React.Dispatch<React.SetStateAction<FmDialogState>>;
  readonly currentPath: string;
  readonly isWindows: boolean;
  readonly fileOperationMutation: UseMutationResult<null, Error, TerminalFileOperation>;
}

export default function FmDialogs({ dialog, setDialog, currentPath, isWindows, fileOperationMutation }: Readonly<FmDialogsProps>) {
  const compressTask = useTerminalCompress();
  const confirmDialog = async () => {
    if (!dialog) return;
    const val = dialog.value.trim();
    if (!val) { Toast.warning('请输入名称'); return; }
    const sep = currentPath.includes('\\') ? '\\' : '/';

    // 名称合法性校验（重命名 / 新建 / 压缩包名）
    if (dialog.mode === 'rename' || dialog.mode === 'newFile' || dialog.mode === 'newDir' || dialog.mode === 'compress') {
      const err = validateEntryName(val, isWindows);
      if (err) { Toast.error(err); return; }
    }

    if (dialog.mode === 'rename') {
      const dest = `${dialog.entry.path.replace(/[/\\]+[^/\\]+$/, '')}${sep}${val}`;
      await fileOperationMutation.mutateAsync({ kind: 'rename', from: dialog.entry.path, to: dest });
      Toast.success('已重命名'); setDialog(null);
    } else if (dialog.mode === 'newFile' || dialog.mode === 'newDir') {
      const type = dialog.mode === 'newDir' ? 'dir' : 'file';
      const newPath = `${currentPath.replace(/[/\\]+$/, '')}${sep}${val}`;
      await fileOperationMutation.mutateAsync({ kind: 'create', path: newPath, type });
      Toast.success('已创建'); setDialog(null);
    } else if (dialog.mode === 'move') {
      await fileOperationMutation.mutateAsync({ kind: 'move', from: dialog.entry.path, to: val });
      Toast.success('已移动'); setDialog(null);
    } else if (dialog.mode === 'copy') {
      await fileOperationMutation.mutateAsync({ kind: 'copy', from: dialog.entry.path, to: val });
      Toast.success('已复制'); setDialog(null);
    } else if (dialog.mode === 'compress') {
      const paths = dialog.selEntries.map((e) => e.path);
      const dest = `${currentPath.replace(/[/\\]+$/, '')}${sep}${val}`;
      await compressTask.mutateAsync({ body: { paths, destPath: dest } });
      // 压缩已转为后台任务：进度与取消由任务托盘承载，页面只确认已受理
      Toast.success('压缩任务已提交，可在任务中心查看进度'); setDialog(null);
    } else if (dialog.mode === 'chmod') {
      const mode = Number.parseInt(val, 8);
      if (Number.isNaN(mode)) { Toast.error('请输入有效的八进制权限值，如 755'); return; }
      await fileOperationMutation.mutateAsync({ kind: 'chmod', path: dialog.entry.path, mode });
      Toast.success('权限已修改'); setDialog(null);
    }
  };

  return (
    <AppModal
      title={dialogTitle(dialog?.mode)}
      visible={!!dialog}
      onCancel={() => setDialog(null)}
      onOk={() => void confirmDialog()}
      okButtonProps={{ loading: fileOperationMutation.isPending }}
      closeOnEsc
      width={480}
    >
      {dialog?.mode === 'chmod' ? (
        <ChmodEditor
          value={dialog.value}
          onChange={(v) => setDialog((d) => d ? { ...d, value: v } : d)}
        />
      ) : (
        <Input
          autoFocus
          value={dialog?.value ?? ''}
          onChange={(v) => setDialog((d) => d ? { ...d, value: v } : d)}
          onEnterPress={() => void confirmDialog()}
          placeholder={dialog?.mode === 'move' || dialog?.mode === 'copy' ? '输入目标完整路径' : '请输入名称'}
        />
      )}
      {dialog?.mode === 'compress' && (
        <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginTop: 8 }}>
          将压缩到当前目录下，输入 ZIP 文件名（含 .zip 扩展名）
        </Typography.Text>
      )}
    </AppModal>
  );
}
