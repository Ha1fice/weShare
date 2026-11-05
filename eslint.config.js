import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import prettier from 'eslint-config-prettier'

/**
 * ESLint flat config。
 *
 * 规则取向：**只拦真问题**，不做风格裁决。
 * 风格由 Prettier 负责（见 .prettierrc），两者职责不重叠——
 * 混在一起会出现"prettier 改完 eslint 又报"的死循环。
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.d.ts',
      // Prisma 生成的 Client —— 自动生成，不参与 lint
      'packages/db/generated/**',
    ],
  },

  // 通用 JS 规则
  js.configs.recommended,

  // TypeScript 规则
  ...tseslint.configs.recommended,

  // Vue 单文件组件
  ...pluginVue.configs['flat/recommended'],

  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
      globals: globals.browser,
    },
  },

  {
    files: ['**/*.ts', '**/*.mts', '**/*.mjs', '**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // 应用代码：Node 端
  {
    files: ['apps/api/**/*.ts', 'apps/collab/**/*.ts', 'packages/db/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // 脚本目录：Node 端，禁用 no-console（脚本本来就是要打印）
  {
    files: ['scripts/**/*.mjs', 'packages/*/scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  {
    rules: {
      // 未使用的变量是错误，但允许 _ 前缀（下划线表示"有意忽略"）
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // 禁止 any：类型不确定时用 unknown + 收窄
      '@typescript-eslint/no-explicit-any': 'error',
      // 空 catch 块要写明理由（数据库关闭时的忽略是合法的，但要显式）
      'no-empty': ['error', { allowEmptyCatch: false }],
      // 浮点数相等比较
      eqeqeq: ['error', 'always'],
      // 优先 const
      'prefer-const': 'error',
    },
  },

  // 前端：浏览器环境
  {
    files: ['apps/web/**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // 测试文件：允许更宽松的规则
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Vue：可选 prop 用 `?:` 声明时，undefined 已经是合法默认值。
  // 这条规则会逼着把每个可选 prop 都写一遍 `default: undefined`，
  // 属于噪声而非安全 —— 关掉。
  {
    files: ['**/*.vue'],
    rules: {
      'vue/require-default-prop': 'off',
    },
  },

  // 最后由 Prettier 关闭与格式相关的规则
  prettier,
)
