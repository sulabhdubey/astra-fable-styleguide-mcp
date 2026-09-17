const runtimeGlobals = {
  console: 'readonly',
  process: 'readonly',
  fetch: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Headers: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  Buffer: 'readonly',
};

export default [
  { ignores: ['dist/**', 'generated/**', 'apps/docs/dist/**', 'apps/docs/dist-portable/**'] },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { globals: runtimeGlobals },
    rules: { 'no-undef': 'error' },
  },
];
