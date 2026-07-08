import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import pluginQuery from '@tanstack/eslint-plugin-query';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/mockServiceWorker.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginQuery.configs['flat/recommended'],
  {
    rules: {
      // queryFn 引用变量必须进 queryKey 的检查误报较多（如 silent 等仅影响行为不影响数据的选项），
      // 关闭此条；插件其余规则（no-unstable-deps 等）保留
      '@tanstack/query/exhaustive-deps': 'off',
    },
  },
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        warnOnUnsupportedTypeScriptVersion: false,
      },
    },
  },
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Classic react-hooks rules only (v7 compiler rules are too strict for this codebase)
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          // MasterDetailLayout 用 Object.assign 挂载 Header/Body 子组件，视为类 HOC 导出
          extraHOCs: ['assign'],
          // 与组件强相关的工厂函数/选项常量，允许与组件同文件导出
          allowExportNames: ['createOperationColumn', 'DATA_SCOPE_OPTIONS'],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // ── Token 纪律（防复发）：与 .stylelintrc.json 的 CSS 规则对应 ──
    // member/approval 为独立主题端，mocks 为静态数据，均不受偏好系统管辖
    files: ['src/**/*.tsx'],
    ignores: ['src/member/**', 'src/approval/**', 'src/mocks/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Property[key.name="borderRadius"][value.type="Literal"][value.value>=2][value.value<=14]',
          message: '内联圆角请使用 var(--semi-border-radius-small/medium/large)，以便跟随「圆角大小」偏好；刻意的造型值请加 eslint-disable 注释并注明理由。',
        },
        {
          selector: String.raw`Property[key.name="boxShadow"] Literal[value=/rgba\(\s*0\s*,\s*0\s*,\s*0/]`,
          message: '自写黑色阴影暗色模式下不可见，请使用 var(--semi-shadow-elevated)；刻意的强调投影请加 eslint-disable 注释并注明理由。',
        },
      ],
    },
  },
];
