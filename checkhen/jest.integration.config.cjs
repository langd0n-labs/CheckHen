const nextJest = require('next/jest');

module.exports = nextJest({ dir: './' })({
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/components/(.*)$': '<rootDir>/components/$1',
    '^@/pages/(.*)$': '<rootDir>/pages/$1',
    '^@/lib/(.*)$': '<rootDir>/lib/$1',
  },
  testMatch: ['**/participation-store.integration.test.ts'],
});
