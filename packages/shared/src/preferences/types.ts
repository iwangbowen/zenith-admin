import type { PreferenceGroup } from './constants';
import type { TerminalPreferences, UserPreferences } from './validation';

export type PreferencePath = Exclude<keyof UserPreferences, 'terminal'> | `terminal.${Exclude<keyof TerminalPreferences, 'favorites'>}`;
export type PersonalPreferencePath = PreferencePath | 'terminal.favorites';
export type PreferenceScalar = string | number | boolean;

/** 只描述偏好之间的适用关系；浏览器授权、菜单权限等环境条件由消费端判断。 */
export type PreferenceCondition =
  | { field: PreferencePath; equals: PreferenceScalar }
  | { field: PreferencePath; in: readonly PreferenceScalar[] }
  | { all: readonly PreferenceCondition[] }
  | { any: readonly PreferenceCondition[] };

export interface PreferenceDefinition {
  path: PreferencePath;
  label: string;
  group: PreferenceGroup;
  kind: 'boolean' | 'select' | 'number' | 'text' | 'color' | 'home-path' | 'terminal-theme';
  description?: string;
  options?: readonly { value: string | number; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  applicableWhen?: PreferenceCondition;
}

export type PreferenceValueAtPath<T, P extends string> = P extends `${infer K}.${infer R}`
  ? K extends keyof T ? PreferenceValueAtPath<NonNullable<T[K]>, R> : never
  : P extends keyof T ? T[P] : never;
