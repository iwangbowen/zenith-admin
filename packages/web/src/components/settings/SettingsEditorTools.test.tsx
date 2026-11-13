import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_MODULES, type SettingsEnvelope } from '@zenith/shared/settings';
import { useSettingsEditor } from '@/hooks/useSettingsEditor';
import { SettingsEditorTools } from './SettingsEditorTools';

vi.mock('@douyinfe/semi-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@douyinfe/semi-ui')>();
  return { ...actual, Toast: { ...actual.Toast, success: vi.fn(), error: vi.fn() } };
});

vi.mock('./SettingsHistoryButton', () => ({ SettingsHistoryButton: () => null }));

describe('设置重载期间的编辑保护', () => {
  it('请求发出后输入的新草稿不会被返回结果清掉', async () => {
    let finish!: () => void;
    const effective = SETTINGS_MODULES.files.schema.parse({});
    const initial: SettingsEnvelope<'files'> = {
      module: 'files', scope: 'platform', tenantId: null, version: 0, currentRevisionId: null,
      baseToken: 'original', definitionHash: 'definition', inheritedVersion: 0, overrides: {},
      overriddenPaths: [], updatedAt: null, effective, inherited: effective,
    };
    function Harness() {
      const [envelope, setEnvelope] = useState(initial);
      const editor = useSettingsEditor('files', envelope);
      return <>
        <SettingsEditorTools module="files" editor={editor} canWrite onReload={() => new Promise((resolve) => {
          finish = () => { setEnvelope({ ...initial, baseToken: 'refreshed' }); resolve({ isError: false }); };
        })} />
        <input aria-label="大小" value={editor.value.uploadMaxSizeMb} onChange={(event) => editor.setField('uploadMaxSizeMb', Number(event.target.value))} />
      </>;
    }
    render(<MemoryRouter><Harness /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '载入最新' }));
    fireEvent.change(screen.getByLabelText('大小'), { target: { value: '25' } });
    await act(async () => finish());
    expect(screen.getByLabelText('大小')).toHaveValue('25');
  });
});
