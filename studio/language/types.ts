export const tupleType = (elements: readonly string[]): string => `tuple(${elements.join(', ')})`;

export function splitTupleType(type: string): string[] | undefined {
  if (!type.startsWith('tuple(') || !type.endsWith(')')) return;
  const elements: string[] = [];
  let depth = 0, start = 6;
  for (let i = start; i < type.length - 1; i++) {
    const char = type[i];
    if (char === '(' || char === '{') depth++;
    else if (char === ')' || char === '}') depth--;
    else if (char === ',' && depth === 0) {
      elements.push(type.slice(start, i).trim());
      start = i + 1;
    }
  }
  elements.push(type.slice(start, -1).trim());
  return elements;
}

export function typeParts(type: string): string[] | undefined {
  return type.startsWith('set{') && type.endsWith('}')
    ? [type.slice(4, -1)]
    : splitTupleType(type);
}

/** Directed compatibility. Unknown types suppress cascaded diagnostics, but are not completion matches. */
export function isCompatible(
  actual: string,
  expected: string,
  relations: Record<string, string[]>,
  allowUnknown = true
): boolean {
  if (actual === '?' || expected === '?') return allowUnknown;
  if (actual === expected || expected === 'Any') return true;
  if (actual.startsWith('set{') && expected.startsWith('set{'))
    return isCompatible(actual.slice(4, -1), expected.slice(4, -1), relations, allowUnknown);
  const actualTuple = splitTupleType(actual), expectedTuple = splitTupleType(expected);
  if (actualTuple && expectedTuple)
    return actualTuple.length === expectedTuple.length && actualTuple.every((part, i) =>
      isCompatible(part, expectedTuple[i], relations, allowUnknown)
    );
  const seen = new Set<string>(),
    pending = [actual];
  while (pending.length) {
    const current = pending.pop()!;
    if (current === expected) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(...(relations[current] ?? []));
  }
  return false;
}

/** Declaration identity uses equivalence, not one-way subtype compatibility. */
export const isEquivalent = (left: string, right: string, relations: Record<string, string[]>) =>
  isCompatible(left, right, relations, false) && isCompatible(right, left, relations, false);

export const sameParameters = (left: string[], right: string[], relations: Record<string, string[]>) =>
  left.length === right.length && left.every((type, index) => isEquivalent(type, right[index], relations));
