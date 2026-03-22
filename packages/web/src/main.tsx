// ⚠️ 必须在最顶部导入，在任何 Semi 组件之前（React 19 兼容）
import '@douyinfe/semi-ui/react19-adapter';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(<App />);
