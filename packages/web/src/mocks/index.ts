/**
 * 按需启动 MSW Mock Service Worker。
 * 仅当 VITE_DEMO_MODE=true 时生效，生产环境构建不包含 MSW。
 */
export async function enableMocking(): Promise<void> {
  if (import.meta.env.VITE_DEMO_MODE !== 'true') return;

  const { worker } = await import('./browser');
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: {
      url: `${import.meta.env.BASE_URL}mockServiceWorker.js`,
    },
  });
}
