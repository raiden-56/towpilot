/** Writes the generated OpenAPI document to docs/openapi.json (for API consumers and typed client generation). */
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';

const server = createApp().listen(0, async () => {
  const { port } = server.address() as AddressInfo;
  const spec = (await (await fetch(`http://127.0.0.1:${port}/api/v1/openapi.json`)).json()) as { paths: Record<string, unknown> };
  const out = path.resolve(process.cwd(), '../../docs/openapi.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(spec, null, 2));
  console.log(`Wrote ${Object.keys(spec.paths).length} paths to ${out}`);
  server.close();
  setTimeout(() => process.exit(0), 200);
});
