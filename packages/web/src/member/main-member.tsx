// ⚠️ 必须在最顶部导入，在任何 Semi 组件之前（React 19 兼容）
import '@douyinfe/semi-ui/react19-adapter';
import { createRoot } from 'react-dom/client';
import MemberApp from './App-member';
import '../styles/global.css';
import './styles/member.css';
import { enableMocking } from '../mocks';
import { initMemberTheme } from './hooks/useMemberTheme';
import { setupVChartSemiTheme } from '../lib/vchart-theme';

// 提前应用主题色，避免页面闪烁
initMemberTheme();
setupVChartSemiTheme();

async function bootstrap() {
  await enableMocking();

  createRoot(document.getElementById('member-root')!).render(<MemberApp />);
}

bootstrap();
