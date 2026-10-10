import { execSync } from 'node:child_process';

/** Applies migrations to the dedicated test database before any test file runs. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://towpilot:towpilot@127.0.0.1:5455/towpilot_test?schema=public';
  if (!/_test\b|test\?/.test(url)) throw new Error(`Refusing to run integration tests against a non-test database: ${url}`);
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
}
