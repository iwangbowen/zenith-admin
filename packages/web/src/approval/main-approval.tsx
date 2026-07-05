// ⚠️ 必须在最顶部导入，在任何 Semi 组件之前（React 19 兼容）
import '@douyinfe/semi-ui/react19-adapter';
// Semi 基础样式：构建时豁免了 semi barrel 的副作用标记（见 vite.config.ts treeshake），
// 其内联的 base.css 会被摇树裁剪，故在入口显式引入
import '@douyinfe/semi-ui/lib/es/_base/base.css';
import { createRoot } from 'react-dom/client';
import ApprovalApp from './App-approval';
import '../styles/global.css';
import './styles/approval.css';
import { enableMocking } from '../mocks';

async function bootstrap() {
  await enableMocking();
  createRoot(document.getElementById('approval-root')!).render(<ApprovalApp />);
}

bootstrap();
