import { Tooltip } from '@douyinfe/semi-ui';
import { getFileTypeIcon } from '@/utils/file-utils';
import '../FilesPage.css';

interface FileNameCellProps {
  name: string;
  mimeType?: string | null;
}

export function FileNameCell({ name, mimeType }: Readonly<FileNameCellProps>) {
  return (
    <div className="files-table-name-cell">
      <span className="files-table-name-cell__icon">
        {getFileTypeIcon(mimeType, 16, name)}
      </span>
      <Tooltip content={name}>
        <span className="files-table-name-cell__text">{name}</span>
      </Tooltip>
    </div>
  );
}
