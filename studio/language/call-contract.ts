/** Declarative call typing, attached to a declaration rather than to a built-in name. */
export interface CallContract {
  overloads?: 'closed';
  collection?: number;
  callback?: number;
  numeric?: boolean;
  sameCollection?: number;
  result?: 'declared' | 'collection' | 'callback' | 'context';
  quantity?: boolean;
}
export function readContract(text: string, arity: number, types?: string[]): CallContract {
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid operator contract.');
  for (const [key, item] of Object.entries(value)) {
    if (['collection', 'callback', 'sameCollection'].includes(key)) {
      if (!Number.isInteger(item) || (item as number) < 0 || (item as number) >= arity)
        throw new Error('Contract parameter index is out of range.');
    } else if (['numeric', 'quantity'].includes(key)) {
      if (typeof item !== 'boolean') throw new Error('Contract flag must be boolean.');
    } else if (key === 'overloads') {
      if (item !== 'closed') throw new Error('Unknown overload policy.');
    } else if (key === 'result') {
      if (!['declared', 'collection', 'callback', 'context'].includes(item as string))
        throw new Error('Unknown contract result.');
    } else throw new Error('Unknown contract field: ' + key);
  }
  if (
    (value.callback !== undefined && value.collection === undefined) ||
    (value.sameCollection !== undefined && value.collection === undefined) ||
    (value.result === 'collection' && value.collection === undefined) ||
    (value.result === 'callback' && value.callback === undefined) ||
    (value.numeric && value.callback === undefined) ||
    (value.quantity && value.result !== 'context')
  )
    throw new Error('Incomplete operator contract.');
  if (types) {
    if (value.callback !== undefined && types[value.callback] !== 'operator')
      throw new Error('算子参数规则必须指向 operator 类型参数。');
    for (const key of ['collection', 'sameCollection'])
      if (value[key] !== undefined && !/^set[({]/.test(types[value[key]]))
        throw new Error('集合规则必须指向 set(类型) 参数。');
  }
  return value;
}
