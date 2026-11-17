import { parse, lex } from './parser';
import {
  profile,
  defaults,
  scalarTypes,
  OperatorSignature,
  Profile,
  SymbolMetadata
} from './profile';
import { isCompatible } from './types';
import { typeName } from './semantic';
import { Library } from './library';
import { Issue, Span } from './ast';
import { CallContract, readContract } from './call-contract';
import { readAliases } from './symbol-aliases';
export interface Entry extends SymbolMetadata {
  kind: 'concept' | 'object' | 'constant' | 'operator';
  name: string;
  type: string;
  params: { name: string; type: string; description?: string }[];
  unit?: string;
  parent?: string;
  parentForm?: 'set';
  span?: Span;
  key?: string;
  contract?: CallContract;
}
export interface Header {
  library: Library;
  entries: Entry[];
  issues: Issue[];
}
export const emptyLibrary = (): Library => ({
  symbolAliases: { concepts: Object.create(null), operators: Object.create(null) },
  types: [],
  typeMetadata: Object.create(null),
  values: Object.create(null),
  operators: Object.create(null),
  compatibility: Object.create(null),
  origins: Object.create(null)
});
export function readHeader(text: string, uri: string): Header {
  const program = parse(text, profile()),
    library = emptyLibrary(),
    entries: Entry[] = [],
    issues = [...program.issues],
    seen = new Set<string>();
  let previousEnd = 0,
    delimiterIndex = 0;
  for (const token of program.tokens)
    if (token.kind === 'comment') {
      const match = token.text.match(/^\/\/ @compatible\s+(\S+)\s+(\S+)\s*$/);
      if (match) (library.compatibility[match[1]] ??= []).push(match[2]);
      const aliases = token.text.match(/^\/\/ @symbolAliases\s+(.+)$/);
      if (aliases)
        try {
          const rules = readAliases(JSON.parse(aliases[1]));
          for (const kind of ['concepts', 'operators'] as const)
            for (const [from, to] of Object.entries(rules[kind])) {
              const previous = library.symbolAliases![kind][from];
              if (previous && previous !== to) throw new Error(`名称别名冲突：${from}`);
              library.symbolAliases![kind][from] = to;
            }
          library.symbolAliases = readAliases(library.symbolAliases);
        } catch (error) {
          issues.push({
            ...token,
            code: 'library',
            message: error instanceof Error ? error.message : '名称别名格式无效。'
          });
        }
    }
  for (const d of program.statements) {
    if (d.kind === 'expression') {
      issues.push({
        ...d,
        code: 'library',
        message: '声明库只允许类型、值和算子声明，不允许约束、规则或 output。'
      });
      continue;
    }
    if (d.initializer)
      issues.push({
        ...d.initializer,
        code: 'library',
        message: '声明库不存储初始值表达式，请将赋值移到普通 KE 文件。'
      });
    const startLine = text.lastIndexOf('\n', d.start - 1) + 1;
    let start = startLine;
    const before = text.slice(previousEnd, startLine).match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const meta: string[] = [];
    for (let j = before.length - 1; j >= 0; j--) {
      if (
        !/^\s*\/\/ @(description|label|aliases|returns|usage|updated|unit|param|contract)\b/.test(
          before[j]
        )
      )
        break;
      meta.unshift(before[j].trim());
      start -= before[j].length;
    }
    if (text.slice(startLine, d.start).trim()) start = d.start;
    const description = meta
      .filter((x) => x.startsWith('// @description '))
      .map((x) => x.slice(16))
      .join('\n');
    let contract: CallContract | undefined;
    const contractLine = meta.find((x) => x.startsWith('// @contract '));
    if (contractLine)
      try {
        if (d.kind !== 'operator') throw new Error('调用类型规则只能用于算子。');
        contract = readContract(contractLine.slice(13), d.params.length, d.params.map(typeName));
      } catch (error) {
        issues.push({ ...d.nameSpan, code: 'library', message: String(error) });
      }
    const unit = meta.find((x) => x.startsWith('// @unit '))?.slice(9);
    const field = (name: string) =>
      meta.find((x) => x.startsWith(`// @${name} `))?.slice(name.length + 5);
    let aliases: string[] | undefined;
    if (field('aliases'))
      try {
        const value: unknown = JSON.parse(field('aliases')!);
        if (
          !Array.isArray(value) ||
          value.length > 30 ||
          value.some(
            (x) => typeof x !== 'string' || !x.trim() || x.length > 100 || /[\x00-\x1f]/.test(x)
          )
        )
          throw new Error();
        aliases = [...new Set((value as string[]).map((x) => x.trim()))];
      } catch {
        issues.push({
          ...d.nameSpan,
          code: 'library',
          message: '@aliases 应为不超过 30 个短名称的 JSON 字符串数组。'
        });
      }
    const usageText = field('usage');
    const usage = usageText === undefined ? undefined : Number(usageText);
    if (usage !== undefined && (!Number.isSafeInteger(usage) || usage < 0))
      issues.push({ ...d.nameSpan, code: 'library', message: '@usage 应为非负整数。' });
    const metadata: SymbolMetadata = {
      description,
      label: field('label'),
      aliases,
      returnDescription: field('returns'),
      usage,
      updated: field('updated')
    };
    while (
      delimiterIndex < program.delimiters.length &&
      (!['statement', 'final'].includes(program.delimiters[delimiterIndex].role) ||
        program.delimiters[delimiterIndex].start < d.end)
    )
      delimiterIndex++;
    const candidate = program.delimiters[delimiterIndex];
    const end =
      candidate && text.slice(d.end, candidate.start).trim() === '' ? candidate.end : d.end;
    const params = d.params.map((t, i) => {
      const name = d.parameterNames?.[i] || `arg${i + 1}`;
      return {
        name,
        type: typeName(t),
        description: meta.find((x) => x.startsWith(`// @param ${name} `))?.slice(name.length + 11)
      };
    });
    const entry: Entry = {
      kind: d.kind,
      key: d.kind === 'operator' ? `${d.name}(${d.params.map(typeName).join(',')})` : d.name,
      contract,
      name: d.name,
      type: d.type ? typeName(d.type) : d.name,
      params,
      ...metadata,
      unit,
      parent: d.parent ? typeName(d.parent) : undefined,
      parentForm: d.parentForm,
      span: { start: Math.max(previousEnd, start), end }
    };
    entries.push(entry);
    previousEnd = end;
    if (
      defaults.outputNames.includes(d.name) ||
      scalarTypes.includes(d.name) ||
      seen.has(entry.key!) ||
      (d.kind !== 'operator' && library.operators[d.name]) ||
      (d.kind === 'operator' && (library.types.includes(d.name) || library.values[d.name]))
    ) {
      issues.push({ ...d.nameSpan, code: 'library', message: `保留名称或重复声明：${d.name}` });
      continue;
    }
    seen.add(entry.key!);
    if (new Set(params.map((p) => p.name)).size !== params.length)
      issues.push({ ...d, code: 'library', message: '参数名称不能重复。' });
    library.origins[d.name] ??= { uri, ...d.nameSpan };
    if (d.kind === 'concept') {
      library.types.push(d.name);
      library.typeMetadata![d.name] = { ...metadata, parent: entry.parent };
      if (entry.parent) (library.compatibility[d.name] ??= []).push(entry.parent);
    } else if (d.kind === 'operator') {
      const signature: OperatorSignature = {
        params: params.map((p) => p.type),
        parameterNames: params.map((p) => p.name),
        parameterDescriptions: params.map((p) => p.description ?? ''),
        returns: entry.type,
        ...metadata,
        unit,
        contract,
        origin: { uri, ...d.nameSpan }
      };
      if (library.operators[d.name]) (library.operators[d.name].overloads ??= []).push(signature);
      else library.operators[d.name] = signature;
    } else
      library.values[d.name] = { type: entry.type, constant: d.kind === 'constant', ...metadata };
  }
  return { library, entries, issues };
}
export function renderEntry(e: Entry): string {
  const id = (s: unknown) => {
    if (typeof s !== 'string') return false;
    const result = lex(s);
    return (
      result.tokens.length === 2 &&
      result.tokens[0].kind === 'id' &&
      result.tokens[0].text === s &&
      !result.issues.length &&
      ![...defaults.outputNames, ...Object.values(defaults.surface).flat()].includes(s)
    );
  };
  if (!e || !['concept', 'object', 'constant', 'operator'].includes(e.kind) || !id(e.name))
    throw new Error('请输入合法且非保留的名称。');
  const typeNode = (s: string) => {
    if (typeof s !== 'string' || s.length > 500) throw new Error('类型过长或无效。');
    const parsed = parse(
      `${defaults.keywords.constant} x ${defaults.surface.Colon[0]} ${s.replace(/set\{/g, defaults.keywords.set + defaults.surface.CallOpen[0]).replaceAll('}', defaults.surface.CallClose[0])}${defaults.style.statement}`
    );
    const d = parsed.statements[0];
    if (parsed.issues.length || parsed.statements.length !== 1 || d?.kind !== 'constant' || !d.type)
      throw new Error('请输入类型名称或 set(类型)。');
    return d.type;
  };
  const type = (s: string) =>
    typeName(typeNode(s))
      .replace(/set\{/g, defaults.keywords.set + defaults.surface.CallOpen[0])
      .replaceAll('}', defaults.surface.CallClose[0]);
  const annotation = (key: string, value?: string) =>
    (value ?? '')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => `// @${key} ${line}`)
      .join('\n');
  const comments = [
    annotation('label', e.label),
    e.aliases?.length ? annotation('aliases', JSON.stringify(e.aliases)) : '',
    annotation('description', e.description),
    annotation('returns', e.returnDescription),
    e.usage !== undefined ? annotation('usage', String(e.usage)) : '',
    annotation('updated', e.updated),
    e.contract
      ? annotation(
          'contract',
          JSON.stringify(
            readContract(
              JSON.stringify(e.contract),
              e.params.length,
              e.params.map((p) => typeName(typeNode(p.type)))
            )
          )
        )
      : '',
    e.kind === 'operator' ? annotation('unit', e.unit) : ''
  ];
  let declaration = '';
  if (e.kind === 'concept') {
    if (e.parent && !id(e.parent)) throw new Error('父类型必须是概念名称。');
    declaration = `${defaults.keywords.concept} ${e.name}${e.parent ? (e.parentForm === 'set' ? ' ' + defaults.surface.Colon[0] + ' ' + defaults.keywords.set + defaults.surface.CallOpen[0] + e.parent + defaults.surface.CallClose[0] : ' ' + defaults.surface.Subtype[0] + ' ' + e.parent) : ''}${defaults.style.statement}`;
  } else if (e.kind === 'operator') {
    if (!Array.isArray(e.params) || e.params.length > 100)
      throw new Error('算子最多支持 100 个参数。');
    if (new Set(e.params.map((p) => p.name)).size !== e.params.length)
      throw new Error('参数名称不能重复。');
    const params = e.params.map((p) => {
      if (!id(p.name)) throw new Error('请输入合法参数名。');
      comments.push(annotation('param ' + p.name, p.description));
      return `${p.name} ${defaults.surface.Colon[0]} ${type(p.type)}`;
    });
    declaration = `${defaults.operatorAliases[0]} ${e.name}${defaults.surface.CallOpen[0]}${params.join(defaults.style.argument + ' ')}${defaults.surface.CallClose[0]} ${defaults.surface.Colon[0]} ${type(e.type)}${defaults.style.statement}`;
  } else
    declaration = `${e.kind === 'constant' ? defaults.keywords.constant + ' ' : ''}${e.name} ${defaults.surface.Colon[0]} ${type(e.type)}${defaults.style.statement}`;
  return [...comments.filter(Boolean), declaration].join('\n');
}
export interface Source {
  id: string;
  name: string;
  uri: string;
  enabled: boolean;
  managed?: boolean;
}
export interface LoadedSource {
  source: Source;
  header?: Header;
  error?: string;
}
export interface SourceStatus {
  id: string;
  name: string;
  uri: string;
  enabled: boolean;
  managed: boolean;
  count: number;
  state: 'loaded' | 'disabled' | 'error';
  message: string;
}
export function combineLibraries(
  base: Library,
  loaded: LoadedSource[]
): { library: Library; statuses: SourceStatus[] } {
  const statuses: SourceStatus[] = loaded.map(({ source: s, header: h, error }) => ({
    ...s,
    managed: !!s.managed,
    count: h?.entries.length ?? 0,
    state: !s.enabled ? 'disabled' : error || h?.issues.length ? 'error' : 'loaded',
    message: error ?? h?.issues[0]?.message ?? ''
  }));
  const definitions = (lib: Library) => [
    ...lib.types,
    ...Object.keys(lib.values),
    ...Object.keys(lib.operators)
  ];
  const owners = new Map(definitions(base).map((n) => [n, '个人配置']));
  const parents = new Map(base.types.map((name) => [name, base.typeMetadata?.[name]?.parent]));
  loaded.forEach((item, i) => {
    if (statuses[i].state !== 'loaded' || !item.header) return;
    for (const name of definitions(item.header.library)) {
      const sameConcept =
        item.header.library.types.includes(name) &&
        parents.has(name) &&
        parents.get(name) === item.header.library.typeMetadata?.[name]?.parent;
      if (owners.has(name) && !sameConcept) {
        statuses[i].state = 'error';
        statuses[i].message = `名称 ${name} 与「${owners.get(name)}」冲突，该库未加载。`;
        break;
      }
    }
    if (statuses[i].state === 'loaded') {
      for (const n of definitions(item.header.library)) owners.set(n, item.source.name);
      for (const n of item.header.library.types)
        parents.set(n, item.header.library.typeMetadata?.[n]?.parent);
    }
  });
  const aliasOwners = new Map<string, { kind: string; target: string }>();
  for (const kind of ['concepts', 'operators'] as const)
    for (const [name, target] of Object.entries(base.symbolAliases?.[kind] ?? {}))
      aliasOwners.set(name, { kind, target });
  loaded.forEach((item, i) => {
    if (statuses[i].state !== 'loaded' || !item.header) return;
    const aliases = item.header.library.symbolAliases;
    const candidates = (['concepts', 'operators'] as const).flatMap((kind) =>
      Object.entries(aliases?.[kind] ?? {}).map(([name, target]) => ({ kind, name, target }))
    );
    const conflict = candidates.find(
      ({ kind, name, target }) =>
        owners.has(name) ||
        (aliasOwners.has(name) &&
          (aliasOwners.get(name)!.kind !== kind || aliasOwners.get(name)!.target !== target))
    );
    if (conflict) {
      statuses[i].state = 'error';
      statuses[i].message = `名称别名 ${conflict.name} 与已加载的声明或别名冲突。`;
    } else for (const { kind, name, target } of candidates) aliasOwners.set(name, { kind, target });
  });
  const inheritance: Record<string, string[]> = Object.create(null);
  loaded.forEach((x, i) => {
    if (statuses[i].state !== 'loaded') return;
    for (const e of x.header?.entries ?? [])
      if (e.parent) (inheritance[e.name] ??= []).push(e.parent);
  });
  loaded.forEach((x, i) => {
    if (statuses[i].state !== 'loaded') return;
    const cycle = x.header?.entries.find(
      (e) => e.parent && isCompatible(e.parent, e.name, inheritance, false)
    );
    if (cycle) {
      statuses[i].state = 'error';
      statuses[i].message = `概念 ${cycle.name} 存在继承循环。`;
    }
  });
  let changed = true;
  while (changed) {
    changed = false;
    const types = new Set([
      ...scalarTypes,
      ...base.types,
      ...loaded.flatMap((x, i) =>
        statuses[i].state === 'loaded' ? (x.header?.library.types ?? []) : []
      )
    ]);
    const valid = (t: string): boolean =>
      t === 'operator' ||
      types.has(t) ||
      (t.startsWith('set{') && t.endsWith('}') && valid(t.slice(4, -1)));
    const operators = new Set([
      ...Object.keys(base.operators),
      ...loaded.flatMap((x, i) =>
        statuses[i].state === 'loaded' ? Object.keys(x.header?.library.operators ?? {}) : []
      )
    ]);
    loaded.forEach((x, i) => {
      if (statuses[i].state !== 'loaded' || !x.header) return;
      const lib = x.header.library;
      const unknown = [
        ...Object.values(lib.values).map((v) => v.type),
        ...Object.values(lib.operators).flatMap((o) =>
          [o, ...(o.overloads ?? [])].flatMap((s) => [...s.params, s.returns])
        ),
        ...Object.entries(lib.compatibility).flatMap(([n, v]) => [n, ...v])
      ].find((t) => !valid(t));
      if (unknown) {
        statuses[i].state = 'error';
        statuses[i].message = `未知类型 ${unknown}。请启用提供此类型的库或补充声明。`;
        changed = true;
      }
      const unknownAlias =
        Object.entries(lib.symbolAliases?.concepts ?? {}).find(
          ([, target]) => !types.has(target)
        ) ??
        Object.entries(lib.symbolAliases?.operators ?? {}).find(
          ([, target]) => !operators.has(target)
        );
      if (unknownAlias) {
        statuses[i].state = 'error';
        statuses[i].message = `名称别名 ${unknownAlias[0]} 的目标 ${unknownAlias[1]} 未声明。`;
        changed = true;
      }
    });
  }
  const library: Library = {
    symbolAliases: {
      concepts: Object.assign(Object.create(null), base.symbolAliases?.concepts),
      operators: Object.assign(Object.create(null), base.symbolAliases?.operators)
    },
    types: [...base.types],
    typeMetadata: Object.assign(Object.create(null), base.typeMetadata),
    values: Object.assign(Object.create(null), base.values),
    operators: Object.assign(Object.create(null), base.operators),
    compatibility: Object.assign(Object.create(null), base.compatibility),
    origins: Object.assign(Object.create(null), base.origins)
  };
  loaded.forEach((x, i) => {
    if (statuses[i].state !== 'loaded' || !x.header) return;
    const lib = x.header.library;
    Object.assign(library.symbolAliases!.concepts, lib.symbolAliases?.concepts);
    Object.assign(library.symbolAliases!.operators, lib.symbolAliases?.operators);
    library.types.push(...lib.types);
    Object.assign(library.typeMetadata!, lib.typeMetadata);
    Object.assign(library.values, lib.values);
    Object.assign(library.operators, lib.operators);
    Object.assign(library.origins, lib.origins);
    for (const [name, targets] of Object.entries(lib.compatibility))
      library.compatibility[name] = [
        ...new Set([...(library.compatibility[name] ?? []), ...targets])
      ];
  });
  library.types = [...new Set(library.types)];
  return { library, statuses };
}
