import { lex } from './parser';
import { defaults } from './profile';
import type { Entry } from './ontology';

export const isPending = (entry: Entry) =>
  entry.kind === 'operator' &&
  (!entry.type.trim() || entry.params.some((parameter) => !parameter.type.trim()));

/** Incomplete CO remains metadata in its domain header, outside the executable grammar. */
export function pendingEntry(value: any): Entry {
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const tokens = lex(name).tokens.filter((token) => token.kind !== 'eof');
  if (
    value.kind !== 'operator' ||
    tokens.length !== 1 ||
    tokens[0].kind !== 'id' ||
    [
      ...Object.values(defaults.surface).flat(),
      ...defaults.outputNames,
      ...defaults.builtInTypes
    ].includes(name)
  )
    throw new Error('待完善 CO 需要一个合法的算子名称。');
  const entry: Entry = {
    kind: 'operator',
    name,
    type: String(value.type || '').trim(),
    params: (value.params || []).map((parameter: any, index: number) => ({
      name: parameter.name || `arg${index + 1}`,
      type: String(parameter.type || '').trim(),
      ...(parameter.description ? { description: String(parameter.description) } : {})
    })),
    ...(value.label ? { label: String(value.label) } : {}),
    ...(value.description ? { description: String(value.description) } : {}),
    ...(value.aliases ? { aliases: value.aliases } : {}),
    ...(value.returnDescription ? { returnDescription: String(value.returnDescription) } : {}),
    ...(value.updated ? { updated: String(value.updated) } : {}),
    draft: true
  };
  if (!isPending(entry)) throw new Error('签名已完整，请保存为正式算子声明。');
  return entry;
}

export function renderPending(entry: Entry) {
  const { draft, ...fields } = pendingEntry(entry);
  return '// @draft ' + JSON.stringify(fields);
}
