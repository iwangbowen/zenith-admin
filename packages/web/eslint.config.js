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

// ── 列表页搜索纪律（constraints-frontend.md → 必须复用的公共 hook / 搜索栏与表格）：
//    受控筛选控件一律 {...bind('字段')} / {...bindKeyword('keyword')}，时间区间一律 DateRangeFilter。
//    漏用这些封装不会报错，只会表现为「点查询没反应」「回车不查询」等难以发现的行为异常。──
const listSearchRestrictions = [
  {
    selector: 'CallExpression[callee.name="setDraftParams"] > ObjectExpression[properties.length=1]',
    message: '单字段草稿写入请用 useListSearch 的 bind(\'字段\') / bindKeyword(\'keyword\') 整体绑定控件；一次改多个字段才用 setDraftParams((p) => ({ ...p, a, b }))。',
  },
  {
    selector: 'JSXAttribute[name.name="onChange"] > JSXExpressionContainer > CallExpression[callee.name="setField"]',
    message: '受控筛选控件请用 {...bind(\'字段\')} 整体绑定，控件回传比字段宽时传 parse：bind(\'x\', (v) => …)；setField 只用于 Checkbox 等非 value / onChange 形态的控件。',
  },
  {
    selector: 'JSXOpeningElement[name.name="DatePicker"] > JSXAttribute[name.name="type"] > Literal[value=/Range$/]',
    message: '搜索区的时间区间请用 @/components/search-filters 的 DateRangeFilter（秒级默认，日期级 type="dateRange"）；表单内用 Form.DatePicker。',
  },
  {
    selector: 'LogicalExpression[operator="||"][right.type="Identifier"][right.name="undefined"]:matches([left.object.name=/^submitted/], [left.object.property.name=/^submitted/], [left.callee.object.object.name=/^submitted/], [left.callee.object.object.property.name=/^submitted/])',
    message: '已提交筛选 → 契约查询参数只映射一次：const filterQuery = useMemo(() => compactParams({ keyword: submittedParams.keyword, … }), [submittedParams])，再 useXxxList({ page, pageSize, ...filterQuery })；不要逐字段写 `x || undefined`。布尔开关按「勾选才筛选」语义写 `flag ? true : undefined`。',
  },
  {
    selector: 'CallExpression[callee.name="useEffect"] > ArrowFunctionExpression:matches([body.type="CallExpression"][body.callee.name="setPage"][body.arguments.0.value=1], [body.type="CallExpression"][body.callee.property.name="setPage"][body.arguments.0.value=1], [body.type="BlockStatement"][body.body.length=1][body.body.0.expression.callee.name="setPage"][body.body.0.expression.arguments.0.value=1], [body.type="BlockStatement"][body.body.length=1][body.body.0.expression.callee.property.name="setPage"][body.body.0.expression.arguments.0.value=1])',
    message: '外部作用域（当前公众号 / 站点 / 空间 / 目录）切换回第 1 页请用 useListSearch / usePagination 的 resetKey（多个来源传数组）；useEffect(() => setPage(1), [scopeId]) 会先用旧页码请求一次新作用域的数据。',
  },
];

// ── 列表页样板纪律（constraints-frontend.md → 必须复用的公共 hook / 表格列）：
//    删除确认 + 成功提示、多选状态、启用/禁用状态标签都已收口到 components/list-page 与 utils/table-columns，
//    页面内再手写一遍只会在文案、颜色、清选中等细节上慢慢漂移。──
const listPageBoilerplateRestrictions = [
  {
    selector: 'CallExpression[callee.name="confirmDelete"] CallExpression[callee.object.name="Toast"][callee.property.name="success"]',
    message: '删除确认后再手写 Toast.success 的组合请用 @/components/list-page 的 deleteAction（操作列）/ confirmAndDelete（批量、面板内）；confirmDelete 只留给不提示成功的场景。',
  },
  {
    selector: ':matches(Property[key.name="rowSelection"], JSXAttribute[name.name="rowSelection"]) Property[key.name="onChange"] > ArrowFunctionExpression TSAsExpression:matches([expression.type="Identifier"], [expression.type="LogicalExpression"])',
    message: '表格多选状态请用 @/components/list-page 的 useRowSelection()，直接把返回的 rowSelection 交给表格；额外的 getCheckboxProps / fixed 走 extra 参数。',
  },
  {
    selector: 'JSXOpeningElement[name.name="Tag"] > JSXAttribute[name.name="color"] > JSXExpressionContainer > ConditionalExpression > BinaryExpression[right.value="enabled"]',
    message: 'enabled / disabled 两态状态标签请用 @/utils/table-columns 的 renderEnabledStatusTag（文案与颜色跟随 COMMON_STATUS_LABELS）；三态或语义不同的标签请加 eslint-disable 注释并注明理由。',
  },
];

// ── Mock 纪律（crud-mock.md）：可选等值筛选统一 matchesFilter(actual, expected)，
//    手写 `!query.x || item.x === query.x` 会把 false / 0 当成「未筛选」。──
const mockRestrictions = [
  {
    selector: 'LogicalExpression[operator="||"][left.type="UnaryExpression"][left.operator="!"][left.argument.type="MemberExpression"][left.argument.object.name="query"] > BinaryExpression.right[operator="==="]',
    message: '可选等值筛选请用 @/mocks/utils/filter 的 matchesFilter(item.x, query.x)；`!query.x || …` 会把 false / 0 误判为未筛选。',
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
        ...listSearchRestrictions,
        ...listPageBoilerplateRestrictions,
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
  {
    // 会员端 / 审批端不受 Token 纪律管辖，但列表页搜索与样板纪律同样适用
    files: ['src/member/**/*.tsx', 'src/approval/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...clipboardRestrictions, ...listSearchRestrictions, ...listPageBoilerplateRestrictions],
    },
  },
  {
    // ── MSW Mock handler：同名规则整体覆盖，故把 clipboardRestrictions 一并带上 ──
    files: ['src/mocks/**/*.ts'],
    ignores: ['src/mocks/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...clipboardRestrictions, ...mockRestrictions],
    },
  },
  {
    // ── 域 hooks 由契约派生：服务端状态一律经 lib/contract-query 访问，key 由 contractKey 生成 ──
    // 同名规则整体覆盖，故此处把根配置的 @zenith/shared 路径限制一并带上
    files: ['src/hooks/queries/**/*.ts'],
    ignores: ['src/hooks/queries/**/*.test.ts', 'src/hooks/queries/**/*.test.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tanstack/react-query',
              importNames: ['useQuery', 'useMutation'],
              message:
                '域 hooks 用 useApiQuery / apiQueryOptions / useApiMutation / useSaveMutation / createResourceQueries（lib/contract-query）；'
                + '仅组合多次请求、非契约通道、多操作分派、上传进度等场景可手写，须在 import 行加 eslint-disable 并注明理由，且 queryKey 仍由 contractKey 生成。',
            },
            { name: '@zenith/shared', message: "请改用域子路径 '@zenith/shared/<domain>'。" },
          ],
        },
      ],
    },
  },
];
