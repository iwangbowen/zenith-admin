import '@wangeditor/editor/dist/css/style.css';
import './RichTextEditor.css';
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
  readOnly?: boolean;
  /** 图片上传接口（默认通用文件上传；CMS 等场景可指向带处理管道的专用接口） */
  uploadServer?: string;
  /** 启用「插入分页符」按钮（CMS 正文多页：前台按 [分页] 标记拆分为多个静态页） */
  enablePageBreak?: boolean;
}

export default function RichTextEditor({
  value = '',
  onChange,
  placeholder = '请输入内容...',
  height = 320,
  disableFullscreen = false,
  readOnly = false,
  uploadServer,
  enablePageBreak = false,
}: Readonly<RichTextEditorProps>) {
  const [editor, setEditor] = useState<IDomEditor | null>(null);

  useEffect(() => {
    return () => {
      if (editor == null) return;
      editor.destroy();
      setEditor(null);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    if (readOnly) {
      editor.disable();
    } else {
      editor.enable();
    }
  }, [editor, readOnly]);

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
        server: uploadServer ?? `${appConfig.apiBaseUrl}/api/files/upload`,
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
        borderRadius: 'var(--semi-border-radius-small)',
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
          display: readOnly ? 'none' : undefined,
        }}
      />
      {enablePageBreak && !readOnly ? (
        <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--semi-color-border)', backgroundColor: 'var(--semi-color-fill-0)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            style={{ border: '1px solid var(--semi-color-border)', borderRadius: 4, padding: '2px 10px', background: 'var(--semi-color-bg-0)', cursor: 'pointer', fontSize: 12, color: 'var(--semi-color-text-1)' }}
            onClick={() => editor?.dangerouslyInsertHtml('<p>[分页]</p>')}
          >
            插入分页符
          </button>
          <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>前台按 [分页] 标记拆分为多页（详情页 _2.html …）</span>
        </div>
      ) : null}
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
