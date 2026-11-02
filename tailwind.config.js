export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: { civic: { obsidian: '#070A11', navy: '#0C1322', surface: '#111B2E', card: '#15223A', border: '#1E2F4F' } },
      fontFamily: { sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'], mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'monospace'] },
      boxShadow: { 'glow-sky': '0 0 25px -5px rgba(56,189,248,.25)', 'glow-emerald': '0 0 25px -5px rgba(16,185,129,.25)' },
    },
  },
  plugins: [],
};
