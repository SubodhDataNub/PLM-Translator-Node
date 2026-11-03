import cds from '@sap/cds/eslint.config.mjs'
import cdsPlugin from '@sap/eslint-plugin-cds'

export default [
  ...cds.recommended,
  cdsPlugin.configs.recommended,
  {
    ignores: [
      'gen/',
      'mta_archives/',
      'Train_Data/',
      'app/*/dist/'
    ]
  },
  {
    files: ['app/**/*.js'],
    languageOptions: {
      globals: {
        navigator: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        ResizeObserver: 'readonly'
      }
    }
  }
]
