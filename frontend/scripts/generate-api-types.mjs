import { readFile, writeFile } from 'node:fs/promises';
const schema = JSON.parse(await readFile(new URL('../../docs/api/openapi.json', import.meta.url),'utf8'));
function type(value) {
  if (value.$ref) return value.$ref.split('/').at(-1);
  if (value.const !== undefined) return JSON.stringify(value.const);
  if (value.enum) return value.enum.map(v=>JSON.stringify(v)).join(' | ');
  if (value.anyOf) return value.anyOf.map(type).join(' | ');
  if (value.type === 'array') return `Array<${type(value.items)}>`;
  if (value.type === 'object') return `{ ${Object.entries(value.properties ?? {}).map(([k,v])=>`${JSON.stringify(k)}${value.required?.includes(k)?'':'?'}: ${type(v)};`).join(' ')} }`;
  return {string:'string',integer:'number',number:'number',boolean:'boolean',null:'null'}[value.type] ?? 'unknown';
}
const output = '// 由 docs/api/openapi.json 生成；请运行 npm run api:types，勿手工修改。\n' + Object.entries(schema.components.schemas).map(([name,value])=>`export type ${name} = ${type(value)};`).join('\n')+'\n';
const target = new URL('../src/lib/api-schema.ts',import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(target,'utf8') !== output) throw new Error('API类型漂移，请重新导出OpenAPI并生成类型。');
} else await writeFile(target,output);
