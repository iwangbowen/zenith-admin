import { lazy, Suspense, type ComponentType, type CSSProperties, type ReactNode } from 'react';

type IllustrationModule = typeof import('@douyinfe/semi-illustrations');
type StripPrefix<K> = K extends `Illustration${infer Name}` ? Name : never;

/** 插画名（不含 `Illustration` 前缀与 `Dark` 后缀）：`Idle` / `NoContent` / `NoAccess` / `NotFound` / `Failure` / `Success` / `Construction` / `NoResult` */
export type IllustrationName = Exclude<StripPrefix<keyof IllustrationModule>, `${string}Dark`>;

interface IllustrationProps {
  readonly style?: CSSProperties;
}

const cache = new Map<string, ComponentType<IllustrationProps>>();

// ~130KB 的 semi-illustrations 只在空态 / 错误态真正渲染时下载，不进入任何入口静态图
function lazyIllustration(exportName: keyof IllustrationModule): ComponentType<IllustrationProps> {
  let component = cache.get(exportName);
  if (!component) {
    component = lazy(() => import('@douyinfe/semi-illustrations').then((m) => ({
      default: m[exportName] as ComponentType<IllustrationProps>,
    })));
    cache.set(exportName, component);
  }
  return component;
}

export interface EmptyIllustrationPair {
  readonly image: ReactNode;
  readonly darkModeImage: ReactNode;
}

/**
 * Semi `Empty` 的 `image` / `darkModeImage` 一对懒加载插画。
 *
 * @example
 * <Empty {...emptyIllustration('Idle', 120)} description="暂无通知" />
 */
export function emptyIllustration(name: IllustrationName, size?: number): EmptyIllustrationPair {
  const Light = lazyIllustration(`Illustration${name}`);
  const Dark = lazyIllustration(`Illustration${name}Dark`);
  const style = size === undefined ? undefined : { width: size, height: size };
  return {
    image: <Suspense fallback={null}><Light style={style} /></Suspense>,
    darkModeImage: <Suspense fallback={null}><Dark style={style} /></Suspense>,
  };
}
