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
