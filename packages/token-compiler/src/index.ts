import { flattenTokenLeaves, resolveToken } from '../../style-spec/src/index.js';

export function compileFlat(tokens:unknown):Record<string,unknown>{const out:Record<string,unknown>={};for(const {path} of flattenTokenLeaves(tokens)) out[path]=resolveToken(tokens,path);return out;}
export function compileCss(tokens:unknown):string{
 const flat=compileFlat(tokens); const lines=Object.entries(flat).map(([k,v])=>`  --${k.replace(/\./g,'-')}: ${Array.isArray(v)?v.join(', '):String(v)};`); return `:root {\n${lines.join('\n')}\n}\n`;
}
export function compileTypeScript(tokens:unknown):string{return `// Generated. Do not edit.\nexport const tokens = ${JSON.stringify(compileFlat(tokens),null,2)} as const;\nexport type TokenName = keyof typeof tokens;\n`;}
export function compileJson(tokens:unknown):string{return JSON.stringify(compileFlat(tokens),null,2)+'\n';}
