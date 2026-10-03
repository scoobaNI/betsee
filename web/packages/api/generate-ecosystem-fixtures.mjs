import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { format } from 'prettier';
const root = new URL('../../../policies/', import.meta.url);
const policies = readdirSync(root).filter(name => name.endsWith('.cedar')).flatMap(name => {
  const cedar = readFileSync(new URL(name, root), 'utf8');
  return [...cedar.matchAll(/@id\("([^"]+)"\)([\s\S]*?)(?=@id\(|$)/g)].map(([, id, body]) => ({ id, name: id.replaceAll('-', ' '), cedar: `@id("${id}")${body.trimEnd()}`, control_ids: [...body.matchAll(/@control\("([^"]+)"\)/g)].map(([, control]) => control) }));
});
writeFileSync(new URL('./src/mock/fixtures/ecosystem-policies.json', import.meta.url), await format(JSON.stringify(policies), { parser: 'json' }));
