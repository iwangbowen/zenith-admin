// 平台 API 补齐（非安全上下文），须先于任何业务模块求值
import '../polyfills';
// ⚠️ 必须在最顶部导入，在任何 Semi 组件之前（React 19 兼容）
import '@douyinfe/semi-ui/react19-adapter';
// Semi 基础样式：构建时豁免了 semi barrel 的副作用标记（见 vite.config.ts treeshake），
// 其内联的 base.css 会被摇树裁剪，故在入口显式引入
import '@douyinfe/semi-ui/lib/es/_base/base.css';
import { createRoot } from 'react-dom/client';
import { MEMBER_TOKEN_KEY } from '@zenith/shared/core';
import { configureTracker, initTracker } from '@/utils/tracker';
import MemberApp from './App-member';
import '../styles/global.css';
import './styles/member.css';
import { initMemberTheme } from './hooks/useMemberTheme';
import { hasMemberAnalyticsConsent } from './hooks/useAnalyticsConsent';

// 提前应用主题色，避免页面闪烁
initMemberTheme();

async function bootstrap() {
  // Demo 模式才把 MSW 拉进模块图：生产构建的关键路径闭包里不出现 src/mocks/**
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    const { enableMocking } = await import('../mocks');
    await enableMocking();
  }

  // 埋点 SDK 运行时参数必须在 initTracker() 之前配置完毕
  configureTracker({
    tokenKey: MEMBER_TOKEN_KEY,
    source: 'web_member',
    appId: 'member',
    rootSelector: '#member-root',
    consentProvider: hasMemberAnalyticsConsent,
  });
  initTracker();

  createRoot(document.getElementById('member-root')!).render(<MemberApp />);
}

bootstrap();
