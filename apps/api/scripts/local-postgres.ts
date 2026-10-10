/**
 * Starts a real, project-local PostgreSQL server for development and tests using the
 * `embedded-postgres` package (downloads official PostgreSQL binaries). It is NOT a mock:
 * migrations and queries run against a genuine PostgreSQL instance.
 *
 *   npm run db:local            -> listens on 127.0.0.1:5455, data in apps/api/.local-pg
 *
 * Use this when you do not have Docker or a local PostgreSQL you can connect to.
 * In production, point DATABASE_URL at a managed PostgreSQL (PostGIS optional).
 */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.env.LOCAL_PG_PORT ?? 5455);
const dataDir = path.resolve(process.cwd(), '.local-pg', 'data');
const firstRun = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'towpilot',
  password: 'towpilot',
  port,
  persistent: true,
  // UTF-8 is required (₹, Indian-language names). Windows would otherwise default to WIN1252.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

async function main() {
  if (firstRun) {
    console.log('Initialising local PostgreSQL cluster in', dataDir);
    await pg.initialise();
  }
  await pg.start();
  for (const db of ['towpilot_dev', 'towpilot_test']) {
    try {
      await pg.createDatabase(db);
      console.log(`Created database ${db}`);
    } catch {
      /* already exists */
    }
  }
  console.log(`Local PostgreSQL ready on postgresql://towpilot:towpilot@127.0.0.1:${port}/towpilot_dev`);
  console.log('Press Ctrl+C to stop.');
}

async function shutdown() {
  console.log('Stopping local PostgreSQL...');
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(async (err) => {
  console.error(err);
  await pg.stop().catch(() => {});
  process.exit(1);
});
