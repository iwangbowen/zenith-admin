import { useRef, useState } from 'react';
import { useUploadCmsResource } from '@/hooks/queries/cms-resources';

type QueuedUpload = { id: string; file: File; siteId: number; folderId?: number; state: 'queued' | 'uploading' | 'success' | 'failed'; error?: string };

/** The original site/folder travel with each file so retries cannot upload into another site. */
export function useCmsUploadQueue() {
  const mutation = useUploadCmsResource();
  const [items, setItems] = useState<QueuedUpload[]>([]);
  const queue = useRef<QueuedUpload[]>([]);
  const running = useRef(false);
  const update = (id: string, patch: Partial<QueuedUpload>) => {
    queue.current = queue.current.map((item) => item.id === id ? { ...item, ...patch } : item);
    setItems([...queue.current]);
  };
  const drain = async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const item = queue.current.find((entry) => entry.state === 'queued');
        if (!item) break;
        update(item.id, { state: 'uploading', error: undefined });
        try {
          await mutation.mutateAsync({ siteId: item.siteId, folderId: item.folderId, file: item.file });
          update(item.id, { state: 'success' });
        } catch (error) { update(item.id, { state: 'failed', error: error instanceof Error ? error.message : '上传失败' }); }
      }
    } finally { running.current = false; }
  };
  return {
    items,
    busy: items.some((item) => item.state === 'queued' || item.state === 'uploading'),
    add: (files: File[], siteId: number, folderId?: number) => {
      queue.current = [...queue.current, ...files.map((file) => ({ id: crypto.randomUUID(), file, siteId, folderId, state: 'queued' as const }))];
      setItems([...queue.current]);
      void drain();
    },
    retry: () => {
      queue.current = queue.current.map((item) => item.state === 'failed' ? { ...item, state: 'queued' as const, error: undefined } : item);
      setItems([...queue.current]);
      void drain();
    },
    clear: () => { queue.current = queue.current.filter((item) => item.state === 'queued' || item.state === 'uploading'); setItems([...queue.current]); },
  };
}
