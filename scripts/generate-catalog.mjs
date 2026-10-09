import { readFile, writeFile } from 'node:fs/promises';

// Protocol facts only: names, types, optionality, version and numeric bounds.
// Human-readable prose is authored here, not copied from upstream documentation.
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/generate-catalog.mjs /path/to/protocol.json');
const protocol = JSON.parse(await readFile(source, 'utf8'));
const words = s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
const requests = protocol.requests.filter(r => !r.deprecated).map(r => {
  const properties = {};
  const required = [];
  for (const f of r.requestFields) {
    const type = { String: 'string', Number: 'number', Boolean: 'boolean', Object: 'object' }[f.valueType];
    const schema = type ? { type } : {};
    schema.description = words(f.valueName) + (f.valueRestrictions ? ` (${f.valueRestrictions})` : '');
    if (f.valueType === 'Object') schema.additionalProperties = true;
    if (type === 'number' && f.valueRestrictions) {
      const min = f.valueRestrictions.match(/>=\s*(-?[\d.]+)/);
      const max = f.valueRestrictions.match(/<=\s*(-?[\d.]+)/);
      if (min) schema.minimum = Number(min[1]);
      if (max) schema.maximum = Number(max[1]);
    }
    properties[f.valueName] = schema;
    if (!f.valueOptional) required.push(f.valueName);
  }
  return {
    requestType: r.requestType, category: r.category, initialVersion: r.initialVersion,
    description: `${words(r.requestType)} in OBS. Discover supported requests with obs_list_requests before using version-specific features.`,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
  };
});
await writeFile(new URL('../src/catalog.json', import.meta.url), JSON.stringify(requests, null, 2) + '\n');
await writeFile(new URL('../src/event-types.json', import.meta.url), JSON.stringify(protocol.events.map(e => e.eventType), null, 2) + '\n');
console.log(`Generated ${requests.length} request schemas.`);
