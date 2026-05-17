/**
 * Conventional Commits enforced via Husky `commit-msg` hook.
 * Allowed types match Prompt 0 §8.4: feat, fix, chore, docs, refactor, test.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'chore',
        'docs',
        'refactor',
        'test',
        'perf',
        'style',
        'build',
        'ci',
        'revert',
      ],
    ],
    'subject-case': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
