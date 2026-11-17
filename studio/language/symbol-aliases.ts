import { scalarTypes, defaults } from './profile';
import { lex } from './parser';

export interface SymbolAliases {
  concepts: Record<string, string>;
  operators: Record<string, string>;
}
export const noAliases: SymbolAliases = { concepts: {}, operators: {} };
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const result = lex(value);
  return (
    result.tokens.length === 2 &&
    result.tokens[0].kind === 'id' &&
    result.tokens[0].text === value &&
    !result.issues.length &&
    ![...scalarTypes, ...defaults.outputNames, ...Object.values(defaults.surface).flat()].includes(
      value
    )
  );
};

/** Explicit, domain-owned spellings only; never infer fuzzy aliases or merge by translation. */
export function readAliases(value: unknown): SymbolAliases {
  if (value === undefined) return noAliases;
  if (!object(value) || Object.keys(value).some((key) => !['concepts', 'operators'].includes(key)))
    throw new Error('symbolAliases 只允许 concepts 和 operators 两个名称映射。');
  const result: SymbolAliases = { concepts: Object.create(null), operators: Object.create(null) };
  for (const kind of ['concepts', 'operators'] as const) {
    const entries = value[kind] ?? {};
    if (!object(entries) || Object.keys(entries).length > 1000)
      throw new Error(`symbolAliases.${kind} 应为名称映射对象，最多 1000 项。`);
    for (const [from, to] of Object.entries(entries)) {
      if (!identifier(from) || !identifier(to))
        throw new Error(`无效的 CO 名称归一配置：${from}；不能映射关键词或基础类型。`);
      result[kind][from] = to;
    }
    for (const from of Object.keys(result[kind])) {
      const seen = new Set([from]);
      let to = result[kind][from];
      while (Object.hasOwn(result[kind], to)) {
        if (seen.has(to)) throw new Error(`CO 名称归一形成循环：${from}`);
        seen.add(to);
        to = result[kind][to];
      }
      result[kind][from] = to;
    }
  }
  if (Object.keys(result.concepts).some((name) => Object.hasOwn(result.operators, name)))
    throw new Error('同一个归一名称不能同时作为概念和算子。');
  return result;
}
export const canonicalName = (map: Record<string, string>, name: string) =>
  Object.hasOwn(map, name) ? map[name] : name;

export const canonicalType = (value: string, aliases: SymbolAliases) =>
  value.replace(/[\p{L}_][\p{L}\p{N}_]*/gu, (name) => canonicalName(aliases.concepts, name));

export function findAliased<T>(
  symbols: Map<string, T>,
  name: string,
  aliases: SymbolAliases
): T | undefined {
  return (
    symbols.get(name) ??
    symbols.get(canonicalName(aliases.concepts, name)) ??
    symbols.get(canonicalName(aliases.operators, name))
  );
}
