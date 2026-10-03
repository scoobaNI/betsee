import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { format } from 'prettier';
const root = new URL('../../../policies/', import.meta.url);
const policies = readdirSync(root).filter(name => name.endsWith('.cedar')).flatMap(name => {
  const cedar = readFileSync(new URL(name, root), 'utf8');
  return [...cedar.matchAll(/@id\("([^"]+)"\)([\s\S]*?)(?=@id\(|$)/g)].map(([, id, body]) => ({ id, name: id.replaceAll('-', ' '), cedar: `@id("${id}")${body.trimEnd()}`, control_ids: [...body.matchAll(/@control\("([^"]+)"\)/g)].map(([, control]) => control) }));
});
const destination = new URL('./src/mock/fixtures/ecosystem-policies.json', import.meta.url);
const output = await format(JSON.stringify(policies), { parser: 'json' });
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== output) throw new Error('Policy fixtures are stale; run node packages/api/generate-ecosystem-fixtures.mjs');
} else writeFileSync(destination, output);
