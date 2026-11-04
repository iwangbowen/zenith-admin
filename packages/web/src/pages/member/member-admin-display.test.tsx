import { describe, expect, it } from 'vitest';
import { memberCellColumn, renderMemberName } from './member-admin-display';

interface Row {
  memberId: number;
  memberName?: string | null;
  memberNickname?: string | null;
}

describe('member admin display helpers', () => {
  it('renders nickname/name fallback to member id', () => {
    expect(renderMemberName({ nickname: '昵称', name: '姓名', memberId: 1 })).toBe('昵称');
    expect(renderMemberName({ name: '姓名', memberId: 1 })).toBe('姓名');
    expect(renderMemberName({ memberId: 9 })).toBe('#9');
    expect(renderMemberName({ memberId: null })).toBe('—');
  });

  it('builds member cell columns from field names', () => {
    const column = memberCellColumn<Row>({ nameField: 'memberName', nicknameField: 'memberNickname', idField: 'memberId' });
    expect(column.dataIndex).toBe('memberName');
    expect(column.render?.(null, { memberId: 3, memberName: '姓名', memberNickname: null }, 0)).toBe('姓名');
  });
});
