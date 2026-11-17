import type { Analysis, Symbol } from './semantic';
import { signatures, displayType } from './semantic';
import type { Profile } from './profile';
import type { Expr } from './ast';

/** Offer declarations for unresolved output variables, never guessed mathematical values. */
export function pendingBindings(a: Analysis, offset: number, symbols: Map<string, Symbol>) {
  const scope = a.comprehensions
    .filter(
      (e): e is Extract<Expr, { kind: 'comprehension' }> =>
        e.kind === 'comprehension' && e.output.end <= offset && offset <= e.end
    )
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  if (!scope) return [];
  const names = new Set(
    a.issues
      .filter(
        (issue) =>
          issue.code === 'undeclared' &&
          scope.output.start <= issue.start &&
          issue.end <= scope.output.end
      )
      .map((issue) => a.references.find((ref) => ref.start === issue.start)?.name)
      .filter((name): name is string => !!name && !symbols.has(name))
  );
  return [...names].map((name) => {
    const expected = new Set<string>();
    for (const [expr] of a.types) {
      if (expr.kind !== 'call' || expr.start < scope.start || expr.end > scope.end) continue;
      const operator = symbols.get(expr.name);
      if (operator?.kind !== 'operator') continue;
      expr.args.forEach((arg, index) => {
        if (arg.kind !== 'id' || arg.name !== name) return;
        for (const signature of signatures(operator)) {
          const type = signature.params[index];
          if (type && type !== 'Any' && type !== 'operator')
            expected.add(expr.projection ? `set{${type}}` : type);
        }
      });
    }
    return { name, type: expected.size === 1 ? displayType([...expected][0]) : '' };
  });
}

/** Enter continues a completed clause. Spelling always comes from the current grammar. */
export function clauseContinuation(source: string, offset: number, a: Analysis, p: Profile) {
  const newline = source.lastIndexOf('\n', offset - 1);
  if (newline < 0 || source.slice(newline + 1, offset).trim()) return [];
  const lineStart = source.lastIndexOf('\n', newline - 1) + 1;
  const token = a.program.tokens
    .filter((t) => t.end <= newline && !['comment', 'eof'].includes(t.kind))
    .at(-1);
  if (!token || token.end <= lineStart || p.surface.ConditionSeparator.includes(token.text))
    return [];
  for (const scope of a.comprehensions) {
    if (
      scope.kind !== 'comprehension' ||
      offset < scope.output.end ||
      offset > scope.end ||
      scope.condition.kind !== 'clauses'
    )
      continue;
    const item = [...scope.condition.bindings, ...scope.condition.conditions].find(
      (item) => item.end === token.end
    );
    if (
      !item ||
      a.issues.some(
        (issue) => issue.code === 'syntax' && item.start <= issue.start && issue.start <= item.end
      )
    )
      continue;
    const pairs = new Map([
      [p.surface.CallOpen[0], p.surface.CallClose[0]],
      [p.surface.SetOpen[0], p.surface.SetClose[0]],
      [p.surface.ProjectionOpen[0], p.surface.ProjectionClose[0]]
    ]);
    const stack: string[] = [];
    for (const part of a.program.tokens.filter(
      (t) => item.start <= t.start && t.end <= item.end && t.kind !== 'comment'
    )) {
      if (pairs.has(part.text)) stack.push(pairs.get(part.text)!);
      else if (stack.at(-1) === part.text) stack.pop();
    }
    if (stack.length) continue;
    return [{ start: item.end, end: item.end, text: p.style.condition }];
  }
  return [];
}
