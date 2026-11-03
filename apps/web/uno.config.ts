import { defineConfig, presetAttributify, presetUno } from 'unocss'

export default defineConfig({
  presets: [presetUno(), presetAttributify()],
  theme: {
    colors: {
      // 平台主色。文档类工具应当低饱和、长时间阅读不刺眼。
      brand: {
        50: '#f0f5ff',
        100: '#e0ebff',
        200: '#c7d9fe',
        300: '#a4bffc',
        400: '#7d9bf8',
        500: '#5b78f0',
        600: '#4259e3',
        700: '#3647c9',
        800: '#2f3ba3',
        900: '#2b3582',
      },
    },
  },
})
