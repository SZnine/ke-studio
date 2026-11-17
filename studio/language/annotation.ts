import { globalSymbols, signatures, typeName, type Analysis } from './semantic';
import { describeDeclaration } from './editor';
import type { Profile } from './profile';
import type { Declaration, Span } from './ast';

export interface AnnotationRequest {
  kind: 'concept' | 'operator';
  name: string;
  type?: string;
  params?: string[];
}
export interface TextEdit extends Span {
  text: string;
}

function endOfStatement(a: Analysis, source: string, item: Span) {
  const separator = a.program.delimiters.find(
    (d) => d.role === 'statement' && d.start >= item.end && !source.slice(item.end, d.start).trim()
  );
  return separator?.end ?? item.end;
}

/** A selected evidence span requests declarations; the current grammar and CO own their spelling. */
export function annotate(source: string, request: AnnotationRequest, a: Analysis, p: Profile) {
  if (!['concept', 'operator'].includes(request.kind)) throw new Error('请选择概念或算子工具。');
  const pending =
    request.kind === 'operator' &&
    p.pendingOperators?.[`${request.name}(${(request.params || []).join(',')})`];
  if (pending)
    return {
      edits: [],
      added: [],
      position: 0,
      draft: true,
      declaration: `${p.operatorAliases[0]} ${request.name}${p.surface.CallOpen[0]}${pending.params.join(p.style.argument + ' ')}${p.surface.CallClose[0]} ${p.surface.Colon[0]} ${pending.returns}`
    };
  const symbols = globalSymbols(p);
  const declarations = a.program.statements.filter(
    (d): d is Declaration => d.kind !== 'expression'
  );
  const groups = new Map<number, string[]>();
  const added: string[] = [],
    visited = new Set<string>();
  const append = (group: number, text: string, name: string) => {
    groups.set(group, [...(groups.get(group) || []), text]);
    added.push(name);
  };
  const concept = (name: string) => {
    if (visited.has(name)) return;
    visited.add(name);
    const existing = declarations.find((d) => d.name === name && d.kind === 'concept');
    const symbol = symbols.get(name);
    if (symbol?.kind !== 'concept') throw new Error(`概念 ${name} 不在当前 CO 范围内。`);
    const parent = existing?.parent?.name || p.typeMetadata[name]?.parent;
    if (parent) concept(parent);
    if (existing) return;
    append(
      0,
      `${p.keywords.concept} ${name}${parent ? ' ' + p.surface.Subtype[0] + ' ' + parent : ''}${p.style.statement}`,
      name
    );
  };
  const includeType = (type: string) => {
    const name = type.replace(/set\{/g, '').replaceAll('}', '');
    concept(name);
  };
  let declaration = '',
    existing: Declaration | undefined;
  if (request.kind === 'concept') {
    concept(request.name);
    existing = declarations.find((d) => d.kind === 'concept' && d.name === request.name);
    declaration =
      groups
        .get(0)
        ?.find((line) => line.startsWith(p.keywords.concept + ' ' + request.name + ' ')) ||
      `${p.keywords.concept} ${request.name}${p.style.statement}`;
  } else if (request.kind === 'operator') {
    const symbol = symbols.get(request.name);
    if (symbol?.kind !== 'operator') throw new Error('请选择当前 CO 中的算子。');
    const selected = signatures(symbol).find(
      (s) =>
        (!request.params || JSON.stringify(s.params) === JSON.stringify(request.params)) &&
        (!request.type || s.type === request.type)
    );
    if (!selected) throw new Error('算子签名已改变，请重新选择。');
    for (const type of [...selected.params, selected.type])
      if (type !== 'operator') includeType(type);
    existing = declarations.find(
      (d) =>
        d.kind === 'operator' &&
        d.name === request.name &&
        JSON.stringify(d.params.map(typeName)) === JSON.stringify(selected.params)
    );
    declaration = `${p.operatorAliases[0]} ${describeDeclaration(selected, p)}${p.style.statement}`;
    if (!existing) append(1, declaration, request.name);
  }
  if (existing) declaration = source.slice(existing.start, endOfStatement(a, source, existing));
  const edits: TextEdit[] = [];
  const rank = (kind: string) =>
    kind === 'concept' ? 0 : kind === 'operator' ? 1 : kind === 'expression' ? 3 : 2;
  for (const [group, lines] of groups) {
    // Dependencies precede existing declarations; all other additions stay before the first use.
    const following = a.program.statements.find(
      (d) => rank(d.kind) >= (group === 0 ? 0 : group + 1)
    );
    const start = following?.start ?? source.length;
    const text =
      (start > 0 && !source.slice(0, start).endsWith('\n') ? '\n' : '') + lines.join('\n') + '\n';
    const shared = edits.find((edit) => edit.start === start);
    if (shared) shared.text += text.replace(/^\n/, '');
    else edits.push({ start, end: start, text });
  }
  return { edits, declaration, added, position: existing?.start ?? edits.at(-1)?.start ?? 0 };
}

/** Drag a whole declaration to the nearest legal statement boundary, never into a call or output body. */
export function moveDeclaration(source: string, selection: Span, offset: number, a: Analysis) {
  const selected = a.program.statements.filter(
    (d): d is Declaration =>
      d.kind !== 'expression' &&
      d.start < selection.end &&
      selection.start < endOfStatement(a, source, d)
  );
  if (!selected.length) throw new Error('请选择概念、算子或实例声明后拖动。');
  const start = selected[0].start,
    end = endOfStatement(a, source, selected.at(-1)!);
  if (a.program.statements.some((d) => d.kind === 'expression' && d.start < end && d.end > start))
    throw new Error('拖动范围请只包含声明。');
  const names = new Set(selected.map((d) => d.name));
  let lower = 0,
    upper = source.length;
  const rank = (kind: string) =>
    kind === 'concept' ? 0 : kind === 'operator' ? 1 : kind === 'expression' ? 3 : 2;
  const minimum = Math.min(...selected.map((d) => rank(d.kind))),
    maximum = Math.max(...selected.map((d) => rank(d.kind)));
  for (const item of a.program.statements) {
    if (start <= item.start && item.end <= end) continue;
    if (rank(item.kind) < minimum) lower = Math.max(lower, endOfStatement(a, source, item));
    if (rank(item.kind) > maximum) upper = Math.min(upper, item.start);
  }
  for (const ref of a.references) {
    const target = ref.target?.declaration;
    if (!target) continue;
    if (start <= ref.start && ref.end <= end && !names.has(target.name))
      lower = Math.max(lower, endOfStatement(a, source, target));
    if ((ref.start < start || ref.start >= end) && names.has(target.name))
      upper = Math.min(
        upper,
        a.program.statements.find((d) => d.start <= ref.start && ref.end <= d.end)?.start ?? upper
      );
  }
  const boundaries = [
    0,
    source.length,
    ...a.program.statements.flatMap((d) => [d.start, endOfStatement(a, source, d)])
  ].filter(
    (position) => position >= lower && position <= upper && (position <= start || position >= end)
  );
  const position = boundaries.sort((a, b) => Math.abs(a - offset) - Math.abs(b - offset))[0];
  if (position === undefined || position === start || position === end)
    return { edits: [], position: start };
  const text =
    (position && source[position - 1] !== '\n' ? '\n' : '') + source.slice(start, end) + '\n';
  return {
    position,
    edits: [
      { start, end, text: '' },
      { start: position, end: position, text }
    ]
  };
}
