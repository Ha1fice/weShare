import { defineConfig, presetAttributify, presetUno } from 'unocss'

/**
 * 设计 token 的唯一真源。
 *
 * 约定：**页面里不写颜色原语**（`bg-blue-600`、`text-gray-500`）。
 * 只写语义 token（`bg-surface`、`text-muted`、`border-line`），
 * 这样换主题是从一处改，而不是全站 find & replace。
 *
 * 命名参照 shadcn/ui 的语义层，但颜色值是按"文档工具长时间阅读"重新选的：
 * 低饱和、层次靠边框与背景差值而不靠阴影堆叠。
 */
export default defineConfig({
  presets: [presetUno(), presetAttributify()],
  theme: {
    colors: {
      /** 主色：克制的中性蓝，用于主操作与选中态。 */
      brand: {
        50: '#eff4ff',
        100: '#dbe6fe',
        200: '#bfd3fe',
        300: '#93b4fd',
        400: '#608dfa',
        500: '#3b6bf6',
        600: '#2551eb',
        700: '#1d3fd8',
        800: '#1e35af',
        900: '#1e328a',
      },
      /** 页面底色（比内容区略深，用层级区分"壳"与"纸"）。 */
      canvas: '#f7f8fa',
      /** 内容区底色。 */
      surface: '#ffffff',
      /** 次级面（侧栏、表头、hover 底）。 */
      subtle: '#f4f5f7',
      /** 边框。分两级：line 是常规分隔，line-strong 是输入框等需要辨识度的。 */
      line: '#e8eaee',
      'line-strong': '#d6d9e0',
      /** 文字三档：正文 / 次级 / 占位。 */
      ink: '#1b1e24',
      muted: '#5f6673',
      faint: '#9aa1ad',
      /** 状态色。语义固定：绿=已保存/成功，红=危险/失败，黄=警告，灰=中性。 */
      success: '#16a34a',
      'success-soft': '#ecfdf3',
      danger: '#dc2626',
      'danger-soft': '#fef2f2',
      warning: '#d97706',
      'warning-soft': '#fffbeb',
    },
    radius: {
      sm: '5px',
      DEFAULT: '7px',
      md: '9px',
      lg: '12px',
    },
    boxShadow: {
      /** 只有浮层用阴影，平面元素靠边框。 */
      pop: '0 8px 24px -6px rgb(16 24 40 / 0.14), 0 2px 6px -2px rgb(16 24 40 / 0.06)',
      modal: '0 24px 56px -16px rgb(16 24 40 / 0.28), 0 4px 12px -4px rgb(16 24 40 / 0.08)',
    },
    fontFamily: {
      sans: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
        'Microsoft YaHei', 'Source Han Sans SC', 'Noto Sans CJK SC', sans-serif`,
      mono: `'SFMono-Regular', ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace`,
    },
  },
  shortcuts: {
    // ---- 布局
    'app-shell': 'flex flex-col h-screen w-screen overflow-hidden bg-canvas text-ink font-sans',
    'row-between': 'flex items-center justify-between',
    'center-col': 'flex items-center justify-center',

    // ---- 面
    'panel': 'bg-surface border border-line rounded-lg',
    'divider': 'border-t border-line',

    // ---- 文本框（输入/文本域共用视觉，尺寸由使用处补）
    'field':
      'w-full bg-surface border border-line-strong rounded px-2.5 py-1.5 text-[13px] text-ink ' +
      'placeholder:text-faint outline-none transition ' +
      'hover:border-[#c3c8d2] focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 ' +
      'disabled:bg-subtle disabled:text-faint disabled:cursor-not-allowed',
    'field-invalid': 'border-danger focus:border-danger focus:ring-danger/15',

    // ---- 焦点环：键盘用户必须看得见
    'focus-ring':
      'outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-1',
  },
  rules: [
    // 无边框的滚动条：目录树与编辑器要"安静"
    [
      'scroll-thin',
      {
        'scrollbar-width': 'thin',
        'scrollbar-color': '#d6d9e0 transparent',
      },
    ],
  ],
  safelist: [
    // 动态拼接的类名不会被扫描到
    'animate-pulse',
  ],
})
