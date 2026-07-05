import { useState } from 'react';
import { Spin } from '@douyinfe/semi-ui';

type Props = Readonly<{
  /** 外链地址（http/https） */
  src: string;
  title: string;
}>;

/**
 * 外链内嵌页：菜单配置 isExternal + embed 时，在系统布局内以 iframe 打开外部页面，
 * 保留侧边栏与多页签体验（对标若依「外链内嵌」）。
 */
export default function EmbedPage({ src, title }: Props) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100dvh - 128px)' }}>
      {!loaded && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" tip="页面加载中…" />
        </div>
      )}
      <iframe
        src={src}
        title={title}
        onLoad={() => setLoaded(true)}
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        allowFullScreen
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
