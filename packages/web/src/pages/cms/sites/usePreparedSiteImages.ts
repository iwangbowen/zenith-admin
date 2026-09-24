import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreparedSiteImage } from './site-image-save';

export function usePreparedSiteImages(sessionKey: string | null) {
  const imagesRef = useRef(new Map<string, PreparedSiteImage>());
  const [images, setImages] = useState<PreparedSiteImage[]>([]);
  const clear = useCallback(() => {
    for (const image of imagesRef.current.values()) URL.revokeObjectURL(image.previewUrl);
    imagesRef.current.clear();
    setImages([]);
  }, []);
  useEffect(() => {
    clear();
    return () => {
      for (const image of imagesRef.current.values()) URL.revokeObjectURL(image.previewUrl);
      imagesRef.current.clear();
    };
  }, [sessionKey, clear]);
  const prepare = (key: string, file: File) => {
    const previous = imagesRef.current.get(key);
    if (previous) URL.revokeObjectURL(previous.previewUrl);
    const image = { key, file, previewUrl: URL.createObjectURL(file) };
    imagesRef.current.set(key, image);
    setImages([...imagesRef.current.values()]);
    return image.previewUrl;
  };
  const remove = (key: string) => {
    const image = imagesRef.current.get(key);
    if (image) URL.revokeObjectURL(image.previewUrl);
    imagesRef.current.delete(key);
    setImages([...imagesRef.current.values()]);
  };
  const uploaded = (key: string, value: string) => {
    const image = imagesRef.current.get(key);
    if (image) imagesRef.current.set(key, { ...image, uploadedValue: value });
    setImages([...imagesRef.current.values()]);
  };
  return { images, prepare, remove, uploaded, clear };
}
