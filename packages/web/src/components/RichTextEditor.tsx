import '@wangeditor/editor/dist/css/style.css';
import { Editor, Toolbar } from '@wangeditor/editor-for-react';
import type { IDomEditor, IEditorConfig, IToolbarConfig } from '@wangeditor/editor';
import { useEffect, useState } from 'react';
import { config as appConfig } from '@/config';
import { TOKEN_KEY } from '@zenith/shared';

interface RichTextEditorProps {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  height?: number;
  disableFullscreen?: boolean;
}

export default function RichTextEditor({
  value = '',
  onChange,
  placeholder = '请输入内容...',
  height = 320,
  disableFullscreen = false,
}: Readonly<RichTextEditorProps>) {
  const [editor, setEditor] = useState<IDomEditor | null>(null);

  useEffect(() => {
    return () => {
      if (editor == null) return;
      editor.destroy();
      setEditor(null);
    };
  }, [editor]);

  const toolbarConfig: Partial<IToolbarConfig> = {
    excludeKeys: [
      'uploadVideo',
      'group-video',
      'insertVideo',
      ...(disableFullscreen ? ['fullScreen'] : []),
    ],
  };

  const editorConfig: Partial<IEditorConfig> = {
    placeholder,
    onChange(e: IDomEditor) {
      onChange?.(e.getHtml());
    },
    MENU_CONF: {
      uploadImage: {
        server: `${appConfig.apiBaseUrl}/api/files/upload`,
        fieldName: 'file',
        headers: {
          Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ''}`,
        },
        customInsert(res: { code: number; data: { url: string } }, insertFn: (url: string, alt: string, href: string) => void) {
          if (res.code === 0) {
            const url = res.data.url.startsWith('http') ? res.data.url : `${appConfig.apiBaseUrl}${res.data.url}`;
            insertFn(url, '', '');
          }
        },
      },
    },
  };

  return (
    <div
      style={{
        border: '1px solid var(--semi-color-border)',
        borderRadius: 4,
        overflow: 'hidden',
        zIndex: 0,
      }}
    >
      <Toolbar
        editor={editor}
        defaultConfig={toolbarConfig}
        mode="default"
        style={{
          borderBottom: '1px solid var(--semi-color-border)',
          backgroundColor: 'var(--semi-color-fill-0)',
        }}
      />
      <Editor
        defaultConfig={editorConfig}
        value={value}
        onCreated={setEditor}
        mode="default"
        style={{ height, overflowY: 'hidden' }}
      />
    </div>
  );
}
