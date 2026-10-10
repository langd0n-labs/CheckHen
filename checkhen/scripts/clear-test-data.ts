/** Events are immutable. Reset the disposable test database to clear seed data. */
if (new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid').pathname !== '/checkhen_test') {
  throw new Error('Only a disposable checkhen_test database can be reset');
}
console.error('Reset checkhen_test with: prisma migrate reset --force');
process.exitCode = 1;
