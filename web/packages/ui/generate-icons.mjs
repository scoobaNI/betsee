import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { format } from 'prettier';

const require = createRequire(import.meta.url);
const contract = readFileSync(new URL('../../../docs/design/components.md', import.meta.url), 'utf8');
const qualified = [...contract.matchAll(/streamline(?:-flex)?:([a-z0-9-]+)/g)].map(([id]) => id);
const short = [...contract.slice(contract.indexOf('## Icon ids')).matchAll(/`([a-z0-9-]+)`/g)].map(([, id]) => id);
const subsets = ['streamline-flex', 'streamline'].map(prefix => {
  const source = require(`@iconify-json/${prefix}/icons.json`);
  const names = new Set([...qualified.filter(id => id.startsWith(`${prefix}:`)).map(id => id.split(':')[1]), ...short.filter(id => source.icons[id])]);
  const icons = Object.fromEntries([...names].map(name => {
    if (!source.icons[name]) throw new Error(`Unknown icon in Design Contract: ${prefix}:${name}`);
    return [name, source.icons[name]];
  }));
  return { prefix, width: source.width, height: source.height, icons };
});
const output = await format(JSON.stringify(subsets), { parser: 'json' });
const destination = new URL('./src/icons.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== output) throw new Error('Icon subset is stale; run node packages/ui/generate-icons.mjs');
} else writeFileSync(destination, output);
