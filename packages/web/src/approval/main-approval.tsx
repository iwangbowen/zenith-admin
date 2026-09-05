// 平台 API 补齐（非安全上下文），须先于任何业务模块求值
import '../polyfills';
// ⚠️ 必须在最顶部导入，在任何 Semi 组件之前（React 19 兼容）
import '@douyinfe/semi-ui/react19-adapter';
// Semi 基础样式：构建时豁免了 semi barrel 的副作用标记（见 vite.config.ts treeshake），
// 其内联的 base.css 会被摇树裁剪，故在入口显式引入
import '@douyinfe/semi-ui/lib/es/_base/base.css';
import { createRoot } from 'react-dom/client';
import ApprovalApp from './App-approval';
import '../styles/global.css';
import './styles/approval.css';

async function bootstrap() {
  // Demo 模式才把 MSW 拉进模块图：生产构建的关键路径闭包里不出现 src/mocks/**
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    const { enableMocking } = await import('../mocks');
    await enableMocking();
  }
  createRoot(document.getElementById('approval-root')!).render(<ApprovalApp />);
}

bootstrap();
