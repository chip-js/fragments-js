module.exports = {
  rules: {
    indent: [2, 2, {SwitchCase: 1}],
    quotes: [2, 'single'],
    'linebreak-style': [2, 'unix'],
    semi: [2, 'always']
  },
  env: {
    node: true,
    browser: true
  },
  globals: {Promise: true},
  extends: 'eslint:recommended'
};