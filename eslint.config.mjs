import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['node_modules/**', 'out/**', 'dist/**', 'design/**', 'coverage/**', '.dev-data/**', '.test-data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/essential'],
  { languageOptions: { globals: { ...globals.node, ...globals.browser } }, rules: { 'vue/multi-word-component-names': 'off', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } },
  { files: ['**/*.vue'], languageOptions: { parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] } } }
)
