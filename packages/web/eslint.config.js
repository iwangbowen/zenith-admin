import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import pluginQuery from '@tanstack/eslint-plugin-query';

// ── 平台 API 纪律：内网以 http://ip 访问时不是安全上下文，navigator.clipboard 为 undefined，
//    读写统一走 @/utils/clipboard（写文本可回退 execCommand，读文本 / 写图片由调用方降级）──
const clipboardRestrictions = [
  {
    selector: 'MemberExpression[object.property.name="clipboard"][property.name=/^(writeText|readText)$/]',
    message: '请使用 @/utils/clipboard 的 copyText / copyTextWithToast / readClipboardText；非安全上下文（HTTP）下 navigator.clipboard 不存在。',
  },
];

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
          // MasterDetailLayout 用 Object.assign 挂载 Header/Body 子组件，视为类 HOC 导出；
          // Semi Form 的 withField(自定义控件) 同样是 HOC 导出（FormXxx 字段包装）
          extraHOCs: ['assign', 'withField'],
          // 与组件强相关的工厂函数/选项常量，允许与组件同文件导出
          allowExportNames: ['createOperationColumn', 'DATA_SCOPE_OPTIONS'],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // @zenith/shared 已按业务域拆分：根入口会把全部 18 个域拉进依赖图与前端产物，
      // 使「改 CMS 类型」这类局部改动波及所有消费方，故禁止直接引用根入口与已废弃的旧巨石路径。
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@zenith/shared',
              message:
                "请改用域子路径：'@zenith/shared/identity' | 'payment' | 'workflow' | 'cms' | 'report' | 'core' 等；种子数据用 '@zenith/shared/seed'。",
            },
            {
              name: '@zenith/shared/types',
              message: "旧巨石路径已删除，请改用 '@zenith/shared/<domain>'。",
            },
            {
              name: '@zenith/shared/validation',
              message: "旧巨石路径已删除，请改用 '@zenith/shared/<domain>'。",
            },
            {
              name: '@zenith/shared/constants',
              message: "旧巨石路径已删除，请改用 '@zenith/shared/<domain>'。",
            },
            {
              name: '@zenith/shared/seed-data',
              message: "旧巨石路径已删除，请改用 '@zenith/shared/seed'。",
            },
          ],
        },
      ],
      // 同名规则在后续 files 更窄的配置块中会被整体覆盖而非合并，Token 纪律块需再带一份 clipboardRestrictions
      'no-restricted-syntax': ['error', ...clipboardRestrictions],
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
        ...clipboardRestrictions,
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
