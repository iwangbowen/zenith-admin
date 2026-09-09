import { getAvatarColor } from '@/utils/avatar-color';

export function GroupGridAvatar({
  name,
  size = 36,
  members,
}: Readonly<{
  name: string;
  size?: number;
  members?: Array<{ id: number; nickname: string; avatar?: string | null }>;
}>) {
  const memberCells = (members ?? []).slice(0, 9).map((member, idx) => ({
    key: `m-${member.id}-${idx}`,
    avatar: member.avatar,
    char: member.nickname.slice(0, 1),
  }));

  const cells = memberCells.length > 0
    ? memberCells
    : [{ key: `placeholder-${name}`, avatar: null, char: '' }];

  const count = cells.length;
  let cols: number;
  let rows: number;
  if (count <= 1) {
    cols = 1;
    rows = 1;
  } else if (count === 2) {
    cols = 2;
    rows = 1;
  } else if (count <= 4) {
    cols = 2;
    rows = 2;
  } else if (count <= 6) {
    cols = 3;
    rows = 2;
  } else {
    cols = 3;
    rows = 3;
  }

  const gap = 1;
  const innerSize = size - 4;
  const cellSize = Math.max(8, Math.floor((innerSize - (cols - 1) * gap) / cols));

  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 'var(--semi-border-radius-medium)',
        padding: 2,
        boxSizing: 'border-box',
        background: 'var(--semi-color-fill-0)',
        border: '1px solid var(--semi-color-border)',
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
        justifyContent: 'center',
        alignContent: 'center',
        gap,
      }}
    >
      {cells.map((cell, idx) => {
        let cellContent: React.ReactNode;
        if (cell.avatar) {
          cellContent = (
            <img
              src={cell.avatar}
              alt={cell.char || '成员'}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          );
        } else if (cell.char) {
          cellContent = cell.char.slice(0, 1).toUpperCase();
        } else {
          cellContent = null;
        }
        return (
          <div
            key={cell.key}
            style={{
              width: cellSize,
              height: cellSize,
              borderRadius: 'var(--semi-border-radius-small)',
              background: cell.char ? getAvatarColor(`${name}-${idx}`) : 'var(--semi-color-fill-1)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: Math.max(8, Math.floor(cellSize * 0.52)),
              lineHeight: 1,
              fontWeight: 600,
              overflow: 'hidden',
            }}
          >
            {cellContent}
          </div>
        );
      })}
    </div>
  );
}
