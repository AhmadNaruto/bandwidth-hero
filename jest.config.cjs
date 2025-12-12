/** @type {import('@jest/types').Config.ProjectConfig} */
module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {},
  testMatch: ['**/tests/**/*.test.mjs'],
  collectCoverageFrom: [
    'functions/**/*.js',
    'util/**/*.js',
    '!tests/**/*.test.mjs',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setupTests.mjs']
};