import { useMemo, useState } from 'react';
import { Button, Checkbox, Modal, Typography } from '@douyinfe/semi-ui';
import { UploadQueuePanel, type UploadQueueItem } from '@/components/UploadQueuePanel';
import type { UploadConflict, UploadItem } from '../hooks/useDriveUploader';

interface DriveUploadQueueProps {
  readonly items: UploadItem[];
  readonly activeCount: number;
  readonly conflict: UploadConflict | null;
  readonly onCancel: (id: string) => void;
  readonly onClear: () => void;
}

/** 右下角浮动上传队列 + 同名冲突询问弹窗（队列展示复用共享 UploadQueuePanel） */
export function DriveUploadQueue({ items, activeCount, conflict, onCancel, onClear }: DriveUploadQueueProps) {
  const [applyAll, setApplyAll] = useState(false);
  const queueItems: UploadQueueItem[] = useMemo(
    () => items.map((item) => ({
      id: item.id,
      name: item.file.name,
      size: item.file.size,
      status: item.status,
      percent: item.percent,
      error: item.error,
      instant: item.instant,
    })),
    [items],
  );

  return (
    <>
      <UploadQueuePanel items={queueItems} activeCount={activeCount} onCancel={onCancel} onClear={onClear} />

      <Modal
        visible={!!conflict}
        title="同名文件已存在"
        closeOnEsc
        onCancel={() => conflict?.resolve(null)}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Checkbox checked={applyAll} onChange={(e) => setApplyAll(!!e.target.checked)}>对本批次其余冲突应用相同选择</Checkbox>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="tertiary" onClick={() => conflict?.resolve(null)}>跳过</Button>
              <Button onClick={() => conflict?.resolve({ policy: 'version', applyAll })}>覆盖为新版本</Button>
              <Button type="primary" theme="solid" onClick={() => conflict?.resolve({ policy: 'rename', applyAll })}>保留两者</Button>
            </div>
          </div>
        )}
      >
        <Typography.Paragraph>
          目标目录已存在「{conflict?.fileName}」。「保留两者」会自动重命名新文件；「覆盖为新版本」把上传内容作为该文件的新版本，历史版本仍可回滚。
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
