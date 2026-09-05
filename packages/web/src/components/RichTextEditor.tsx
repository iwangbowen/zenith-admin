import '@wangeditor/editor/dist/css/style.css';
import './RichTextEditor.css';
import { Editor, Toolbar } from '@wangeditor/editor-for-react';
import type { IDomEditor, IEditorConfig, IToolbarConfig } from '@wangeditor/editor';
import { useEffect, useState } from 'react';
import { fileContract, type ManagedFile } from '@zenith/shared/platform';
import { config as appConfig } from '@/config';
import { urlOf } from '@/lib/contract-query';
import { request } from '@/utils/request';

export interface RichTextEditorProps {
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
    // 默认粘贴管线会丢弃 <ul>/<ol> 列表结构（实测整段被吞或降级为纯文本段落）。
    // 改走官方 HTML 解析入口 dangerouslyInsertHtml，保留标题/列表/引用/图片等语义；
    // 内容安全由服务端白名单净化与渲染端 DOMPurify 兜底。
    customPaste(e: IDomEditor, event: ClipboardEvent): boolean {
      const html = event.clipboardData?.getData('text/html');
      if (html?.trim()) {
        e.dangerouslyInsertHtml(html);
        event.preventDefault();
        return false;
      }
      return true;
    },
    MENU_CONF: {
      uploadImage: {
        server: uploadServer ?? `${appConfig.apiBaseUrl}${urlOf(fileContract.upload)}`,
        fieldName: 'file',
        headers: request.authHeaders(),
        // 通用上传接口返回文件数组（每次只传一张图），专用接口返回单个文件
        customInsert(res: { code: number; data: Pick<ManagedFile, 'url'> | Pick<ManagedFile, 'url'>[] }, insertFn: (url: string, alt: string, href: string) => void) {
          const file = Array.isArray(res.data) ? res.data[0] : res.data;
          if (res.code === 0 && file) {
            const url = file.url.startsWith('http') ? file.url : `${appConfig.apiBaseUrl}${file.url}`;
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
            style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)', padding: '2px 10px', background: 'var(--surface-card)', cursor: 'pointer', fontSize: 12, color: 'var(--semi-color-text-1)' }}
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
