import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function sanitizeChunkName(name: string) {
  return name.replace(/^@/, '').replace(/[\/]/g, '-');
}

function getPackageName(id: string) {
  const packagePath = id.replace(/\\/g, '/').split('/node_modules/').pop();
  if (!packagePath) {
    return null;
  }

  const segments = packagePath.split('/');
  if (segments[0]?.startsWith('@')) {
    return segments.slice(0, 2).join('/');
  }

  return segments[0] ?? null;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_BASE_URL || 'http://localhost:3300';
  const port = Number(env.VITE_PORT) || 5373;
  // GitHub Pages 部署时通过环境变量注入 base 路径（如 /zenith-admin/）
  const base = env.VITE_BASE_URL || '/';
  // 使用 esnext 目标（React 19 要求现代浏览器）
  const buildTarget = 'esnext';

  return {
    base,
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      ...(buildTarget ? { target: buildTarget } : {}),
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/');

            if (!normalizedId.includes('node_modules')) {
              return undefined;
            }

            if (normalizedId.includes('/node_modules/@wangeditor/editor-for-react/')) {
              return 'vendor-editor-react';
            }

            if (normalizedId.includes('/node_modules/@wangeditor/editor/')) {
              return 'vendor-editor-core';
            }

            if (normalizedId.includes('/node_modules/recharts/')) {
              return 'vendor-charts';
            }

            if (normalizedId.includes('/node_modules/@douyinfe/semi-ui/lib/es/')) {
              const componentName = normalizedId.split('/node_modules/@douyinfe/semi-ui/lib/es/')[1]?.split('/')[0];
              if (componentName) {
                return `vendor-semi-${sanitizeChunkName(componentName)}`;
              }
            }

            if (
              normalizedId.includes('/react/')
              || normalizedId.includes('/react-dom/')
              || normalizedId.includes('/react-router/')
              || normalizedId.includes('/react-router-dom/')
            ) {
              return 'vendor-react';
            }

            if (normalizedId.includes('/node_modules/@iconify/react/')) {
              return 'vendor-iconify';
            }

            const packageName = getPackageName(normalizedId);
            return packageName ? `vendor-${sanitizeChunkName(packageName)}` : 'vendor-misc';
          },
        },
      },
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
