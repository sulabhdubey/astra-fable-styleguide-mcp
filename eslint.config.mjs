export default [
  { ignores: ['dist/**','generated/**','apps/docs/dist/**'] },
  { files: ['**/*.mjs','**/*.js'], rules: { 'no-undef': 'error' } }
];
