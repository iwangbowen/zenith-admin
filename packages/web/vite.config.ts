import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_BASE_URL || 'http://localhost:3300';
  const port = Number(env.VITE_PORT) || 5373;
  // GitHub Pages 部署时通过环境变量注入 base 路径（如 /zenith-admin/）
  const base = env.VITE_BASE_URL || '/';
  // Demo 模式使用 top-level await，需要 esnext 目标构建
  const buildTarget = mode === 'demo' ? 'esnext' : undefined;

  return {
    base,
    plugins: [react()],
    build: {
      ...(buildTarget ? { target: buildTarget } : {}),
    },
    server: {
      port,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
