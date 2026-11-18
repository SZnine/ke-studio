import { Declaration, Expr, Issue, Program, Span, TypeRef } from './ast';

import {
  Profile,
  defaults,
  scalarTypes,
  operatorTable,
  OperatorSignature,
  isNumericType,
  SymbolMetadata
} from './profile';
import { isCompatible, isEquivalent, sameParameters } from './types';
import { CallContract } from './call-contract';
import { canonicalName, canonicalType, findAliased } from './symbol-aliases';
export interface Symbol extends SymbolMetadata {
  name: string;
  kind: Declaration['kind'];
  type: string;
  params: string[];
  declaration?: Declaration;
  unit?: string;
  parameterNames?: string[];
  parameterDescriptions?: string[];
  contract?: CallContract;
  overloads?: Symbol[];
  origin?: Profile['origins'][string];
}
export const signatures = (s: Symbol): Symbol[] => [s, ...(s.overloads ?? [])];
function selectSignature(
  choices: Symbol[],
  actual: string[],
  relations: Profile['compatibility'],
  projection = false
): Symbol | undefined {
  const score = (s: Symbol) =>
    actual.reduce((total, type, i) => {
      const expected = projection ? `set{${s.params[i]}}` : s.params[i];
      return (
        total +
        (type === '?'
          ? 0
          : type === expected
            ? 4
            : isCompatible(type, expected, relations)
              ? expected === 'Any'
                ? 1
                : 2
              : -4)
      );
    }, 0);
  return [...choices].sort((a, b) => score(b) - score(a))[0];
}
export interface Reference extends Span {
  name: string;
  declaration: boolean;
  target?: Symbol;
}
export interface Analysis {
  program: Program;
  symbols: Map<string, Symbol>;
  references: Reference[];
  issues: Issue[];
  types: Map<Expr, string>;
  comprehensions: Expr[];
  scopes: { span: Span; symbols: Map<string, Symbol>; bindingsStart?: number }[];
  compatibility: Profile['compatibility'];
}
export const typeName = (t: TypeRef): string =>
  t.element ? `set{${typeName(t.element)}}` : t.name;
/** The same library symbols feed analysis and declaration-name completion. */
export function globalSymbols(p: Profile): Map<string, Symbol> {
  const symbols = new Map<string, Symbol>();
  for (const name of p.builtInTypes)
    symbols.set(name, {
      ...p.typeMetadata[name],
      name,
      kind: 'concept',
      type: name,
      params: [],
      origin: p.origins[name]
    });
  for (const [name, s] of Object.entries(p.values))
    symbols.set(name, {
      ...s,
      name,
      kind: s.constant ? 'constant' : 'object',
      type: s.type,
      params: [],
      description: s.description,
      origin: p.origins[name]
    });
  const fromSignature = (name: string, s: OperatorSignature): Symbol => ({
    ...s,
    name,
    kind: 'operator',
    type: s.returns,
    origin: s.origin ?? p.origins[name],
    overloads: s.overloads?.map((x) => fromSignature(name, x))
  });
  for (const [name, signature] of Object.entries(p.operators))
    symbols.set(name, fromSignature(name, signature));
  return symbols;
}
export function analyzeProgram(program: Program, p: Profile = defaults, source = ''): Analysis {
  const symbols = globalSymbols(p),
    references: Reference[] = [],
    issues = [...program.issues],
    types = new Map<Expr, string>(),
    comprehensions: Expr[] = [];
  const table = operatorTable(p),
    scopes: Analysis['scopes'] = [];
  const quantities = new Set<string>();
  // Numeric means Number and every declared subtype of it, not a hardcoded name list.
  const numeric = (t: string) =>
    isNumericType(t, p) ||
    quantities.has(t) ||
    isCompatible(t, p.numberLiteralType, relations, false);
  let ruleHead: Expr | undefined;
  let initializing: string | undefined;
  let env = symbols,
    statementStart = Infinity,
    outputs = 0,
    topOutput: Expr | undefined;
  const lookup = (name: string) => findAliased(env, name, p.symbolAliases);
  const global = (name: string) => findAliased(symbols, name, p.symbolAliases);
  const typeOf = (t: TypeRef) => canonicalType(typeName(t), p.symbolAliases);
  const relations: Profile['compatibility'] = Object.assign(
    Object.create(null),
    Object.fromEntries(Object.entries(p.compatibility).map(([k, v]) => [k, [...v]]))
  );
  for (const alias of p.numberTypeAliases)
    if (alias !== p.numberLiteralType) {
      (relations[p.numberLiteralType] ??= []).push(alias);
      (relations[alias] ??= []).push(p.numberLiteralType);
    }
  // Inheritance edges only: compatibility aliases and @compatible rules are not parents.
  const inheritance: Profile['compatibility'] = Object.assign(
    Object.create(null),
    Object.fromEntries(
      Object.entries(p.typeMetadata)
        .filter(([, metadata]) => metadata.parent)
        .map(([name, metadata]) => [name, [metadata.parent!]])
    )
  );
  let equationDepth = 0;
  const issue = (s: Span, code: string, message: string, fix?: Issue['fix']) =>
    issues.push({ ...s, code, message, fix });
  function ref(name: string, s: Span, declaration = false, checkOrder = true) {
    const target = lookup(name);
    if (!declaration && name === initializing && target === symbols.get(name))
      issue(s, 'declaration-order', 'An initializer cannot refer to its own constant.');
    references.push({ ...s, name, declaration, target });
    if (
      !declaration &&
      checkOrder &&
      p.declarationOrder &&
      target?.declaration &&
      global(name) === target &&
      target.declaration.start > statementStart
    )
      issue(s, 'declaration-order', `Declare '${name}' before use.`);
  }
  for (const d of program.statements) {
    if (d.kind === 'expression') continue;
    if (
      d.kind === 'constant' &&
      p.constantNamePattern &&
      !new RegExp(p.constantNamePattern, 'u').test(d.name)
    )
      issue(d.nameSpan, 'naming-style', '常量名称应以小写字母开头。');
    if (p.outputNames.includes(d.name))
      issue(d.nameSpan, 'reserved-output', `'${d.name}' is reserved for output.`);
    const name =
      d.kind === 'concept'
        ? canonicalName(p.symbolAliases.concepts, d.name)
        : d.kind === 'operator'
          ? canonicalName(p.symbolAliases.operators, d.name)
          : d.name;
    const previous = symbols.get(name);
    const candidate: Symbol = {
      ...(d.kind === 'concept' ? p.typeMetadata[name] : {}),
      name,
      kind: d.kind,
      type: d.type ? typeOf(d.type) : name,
      params: d.params.map(typeOf),
      parameterNames: d.parameterNames?.some(Boolean)
        ? d.parameterNames.map((n, i) => n || `arg${i + 1}`)
        : undefined,
      declaration: d
    };
    if (previous && previous.kind === 'operator' && candidate.kind === 'operator') {
      const same = signatures(previous).find((x) => sameParameters(x.params, candidate.params, relations));
      const source =
        same ?? signatures(previous).find((x) => x.params.length === candidate.params.length);
      if (same) {
        candidate.label = same.label;
        candidate.aliases = same.aliases;
        candidate.description = same.description;
        candidate.returnDescription = same.returnDescription;
        candidate.usage = same.usage;
        candidate.updated = same.updated;
        candidate.parameterNames ??= same.parameterNames;
        candidate.parameterDescriptions = same.parameterDescriptions;
      }
      if (
        source?.contract &&
        (source.contract.callback === undefined ||
          candidate.params[source.contract.callback] === 'operator')
      )
        candidate.contract = source.contract;
      if (same?.declaration)
        issue(d.nameSpan, 'duplicate', `Duplicate local overload '${d.name}'.`);
      else if (same && !isEquivalent(same.type, candidate.type, relations))
        issue(d.nameSpan, 'library-signature',
          `算子 '${d.name}' 返回类型与库不一致：库中为 ${displayType(same.type)}，文档为 ${displayType(candidate.type)}。`);
      else if (same) {
        if (same === previous) {
          candidate.overloads = previous.overloads;
          symbols.set(name, candidate);
        } else previous.overloads = previous.overloads!.map((x) => (x === same ? candidate : x));
      } else if (signatures(previous).some((s) => s.contract?.overloads === 'closed'))
        issue(
          d.nameSpan,
          'closed-overload',
          `算子 '${d.name}' 的签名由声明库限定，请在库中修改，不能在文档中新增此签名。`
        );
      else (previous.overloads ??= []).push(candidate);
    } else if (
      previous?.kind === 'concept' &&
      candidate.kind === 'concept' &&
      !previous.declaration &&
      // A built-in scalar has no library origin, so it may only be restated bare.
      (previous.origin ? !scalarTypes.includes(name) : scalarTypes.includes(name) && !d.parent)
    ) {
      // Explicit local parents describe this document's ontology. Imported definitions
      // remain unchanged; declarations without a parent retain the imported hierarchy.
      // Replacing a parent must not erase independent compatibility rules (e.g. numeric aliases).
      const importedParent = p.typeMetadata[name]?.parent;
      if (d.parent && importedParent && importedParent !== typeOf(d.parent))
        relations[name] = (relations[name] ?? []).filter((type) => type !== importedParent);
      symbols.set(name, candidate);
    } else if (previous) issue(d.nameSpan, 'duplicate', `Duplicate declaration '${d.name}'.`);
    else symbols.set(name, candidate);
    ref(d.name, d.nameSpan, true);
    references[references.length - 1].target = candidate;
  }
  function checkType(t: TypeRef) {
    if (t.name === 'operator' && !t.element) return;
    if (t.element) {
      checkType(t.element);
      return;
    }
    ref(t.name, t);
    if (global(t.name)?.kind !== 'concept') issue(t, 'unknown-type', `Unknown type '${t.name}'.`);
  }
  if (p.conceptRoot && symbols.get(p.conceptRoot)?.kind === 'concept')
    for (const s of symbols.values())
      if (
        s.kind === 'concept' &&
        s.name !== p.conceptRoot &&
        !scalarTypes.includes(s.name) &&
        !p.numericTypes.includes(s.name) &&
        !p.numberTypeAliases.includes(s.name) &&
        ![p.numberLiteralType, p.stringLiteralType, p.booleanType].includes(s.name)
      )
        (relations[s.name] ??= []).push(p.conceptRoot);
  for (const d of program.statements)
    if (d.kind !== 'expression') {
      statementStart = d.start;
      d.params.forEach(checkType);
      if (d.type) checkType(d.type);
      if (d.parameterNames) {
        const names = d.parameterNames.filter(Boolean);
        if (new Set(names).size !== names.length)
          issue(d, 'duplicate', 'Parameter names must be unique.');
      }
      if (d.parent) {
        const parent = typeOf(d.parent),
          name = canonicalName(p.symbolAliases.concepts, d.name);
        checkType(d.parent);
        if (d.parent.element)
          issue(d.parent, 'unknown-type', 'A concept parent must be an object concept.');
        else if (global(parent)?.kind === 'concept') {
          // A built-in concept can be a parent, so documents can write Number and its subtypes.
          if (parent === name || isCompatible(parent, name, inheritance, false))
            issue(d.parent, 'inheritance-cycle', `Cyclic inheritance involving '${d.name}'.`);
          else {
            (relations[name] ??= []).push(parent);
            (inheritance[name] ??= []).push(parent);
          }
        }
      }
    }
  const compare = (actual: string, expected: string, s: Span) => {
    if (!isCompatible(actual, expected, relations))
      issue(s, 'type-mismatch', `Expected ${expected}, received ${actual}.`);
  };
  function withBody(body: Expr, span: Span, finish: () => string): string {
    if (body.kind !== 'clauses') return finish();
    const parent = env;
    env = new Map(parent);
    const local = new Set<string>();
    const items = [
      ...body.bindings.map((b) => ({ start: b.start, b })),
      ...body.conditions.map((c) => ({ start: c.start, c }))
    ].sort((a, b) => a.start - b.start);
    for (const item of items) {
      if ('c' in item) {
        infer(item.c, p.booleanType, true);
        continue;
      }
      const b = item.b;
      let type = '?';
      if (b.type) {
        const value = lookup(b.type.name);
        if (!b.type.element && value && value.kind !== 'concept') {
          ref(b.type.name, b.type);
          if (value.type.startsWith('set{')) type = value.type.slice(4, -1);
          else issue(b.type, 'domain', 'A binding domain must be a type or a set value.');
        } else {
          checkType(b.type);
          type = typeOf(b.type);
        }
      }
      if (b.domain) {
        const t = infer(b.domain);
        if (t.startsWith('set{')) type = t.slice(4, -1);
        else if (t !== '?') issue(b.domain, 'domain', `Expected a set domain, received ${t}.`);
      }
      if (local.has(b.name))
        issue(b.nameSpan, 'duplicate', `Duplicate local declaration '${b.name}'.`);
      if (p.outputNames.includes(b.name))
        issue(b.nameSpan, 'reserved-output', 'Output cannot be a local binding.');
      local.add(b.name);
      const kind = b.constant ? 'constant' : 'object';
      const d: Declaration = {
        kind,
        name: b.name,
        nameSpan: b.nameSpan,
        type: b.type,
        params: [],
        start: b.start,
        end: b.end
      };
      env.set(b.name, { name: b.name, kind, type, params: [], declaration: d });
      ref(b.name, b.nameSpan, true);
    }
    scopes.push({ span, symbols: new Map(env), bindingsStart: body.start });
    const result = finish();
    env = parent;
    return result;
  }
  function infer(e: Expr, expected?: string, formula = false): string {
    let t = '?';
    switch (e.kind) {
      case 'id': {
        if (e.name === '?') return '?';
        ref(e.name, e);
        const s = lookup(e.name);
        if (!s && equationDepth && p.equationSymbols) t = p.numberLiteralType;
        else if (!s)
          issue(
            e,
            'undeclared',
            `Undeclared identifier '${e.name}'.`,
            env === symbols && expected && expected !== '?'
              ? { name: e.name, type: expected }
              : undefined
          );
        else if (p.missingValues.includes(e.name)) {
          issue(e, 'missing-value', 'The source does not define this value; no value is inferred.');
        } else if (s.kind === 'concept' && p.conceptSets && !scalarTypes.includes(s.name))
          t = `set{${s.name}}`;
        else if (s.kind === 'operator' && expected === 'operator') t = 'operator';
        else if (s.kind === 'concept' || s.kind === 'operator')
          issue(e, 'invalid-expression', `'${e.name}' is a ${s.kind}, not a value.`);
        else t = s.type;
        break;
      }
      case 'literal':
        t = e.type;
        break;
      case 'call': {
        ref(e.name, e.nameSpan, false, false);
        const callReference = references.at(-1)!;
        const s = lookup(e.name);
        if (!s || s.kind !== 'operator') {
          issue(e.nameSpan, 'unknown-operator', `Unknown operator '${e.name}'.`);
          e.args.forEach((a) => infer(a));
          break;
        }
        const quick = (a: Expr | undefined): string => {
          if (!a) return '?';
          if (a.kind === 'call') {
            const nested = lookup(a.name);
            if (nested?.kind !== 'operator') return '?';
            const match = selectSignature(
              signatures(nested).filter((s) => s.params.length === a.args.length),
              a.args.map(quick),
              relations,
              !!a.projection
            );
            if (!match) return '?';
            const contract = match.contract;
            let value = match.type;
            if (contract?.result === 'collection') value = quick(a.args[contract.collection!]);
            if (contract?.result === 'callback') {
              const cb = a.args[contract.callback!];
              const fn = cb?.kind === 'id' ? lookup(cb.name) : undefined;
              if (fn?.kind === 'operator')
                value =
                  selectSignature(
                    signatures(fn).filter((s) => s.params.length === 1),
                    [quick(a.args[contract.collection!]).slice(4, -1)],
                    relations
                  )?.type ?? value;
            }
            return a.projection ? `set{${value}}` : value;
          }
          return a.kind === 'literal'
            ? a.type
            : a.kind === 'id'
              ? lookup(a.name)?.kind === 'operator'
                ? 'operator'
                : lookup(a.name)?.kind === 'concept'
                  ? `set{${lookup(a.name)!.type}}`
                  : (lookup(a.name)?.type ?? '?')
              : a.kind === 'set'
                ? `set{${a.elements.length ? quick(a.elements[0]) : '?'}}`
                : '?';
        };
        const candidates = signatures(s).filter((x) =>
          e.projection
            ? x.params.length === 1 && e.args.length === 1
            : x.params.length === e.args.length
        );
        const selected =
          selectSignature(candidates, e.args.map(quick), relations, !!e.projection) ?? s;
        callReference.target = selected;
        if (
          p.declarationOrder &&
          selected.declaration &&
          selected.declaration.start > statementStart
        )
          issue(e.nameSpan, 'declaration-order', `Declare '${e.name}' before use.`);
        if (!candidates.length)
          issue(
            e.nameSpan,
            'arity',
            `Available parameter counts: ${signatures(s)
              .map((x) => x.params.length)
              .join(', ')}; received ${e.args.length}.`
          );
        const args = e.args.map((arg, i) =>
          infer(arg, e.projection ? `set{${selected.params[0]}}` : selected.params[i])
        );
        t = e.projection ? `set{${selected.type}}` : selected.type;
        const contract = selected.contract;
        if (contract && !e.projection) {
          const collection =
            contract.collection === undefined ? undefined : args[contract.collection];
          let callback: Symbol | undefined;
          if (contract.callback !== undefined) {
            const argument = e.args[contract.callback];
            const symbol = argument?.kind === 'id' ? lookup(argument.name) : undefined;
            const element = collection?.startsWith('set{') ? collection.slice(4, -1) : undefined;
            if (symbol?.kind === 'operator' && element) {
              callback = signatures(symbol).find(
                (x) =>
                  x.params.length === 1 &&
                  isCompatible(element, x.params[0], relations) &&
                  (!contract.numeric || numeric(x.type))
              );
              if (!callback)
                issue(
                  argument,
                  'callback-signature',
                  `Expected a unary operator accepting ${element}${contract.numeric ? ' and returning a configured numeric type' : ''}.`
                );
              else {
                const reference = [...references]
                  .reverse()
                  .find((r) => r.start === argument.start && r.target === symbol);
                if (reference) reference.target = callback;
              }
            }
          }
          if (contract.result === 'collection' && collection) t = collection;
          if (contract.result === 'callback' && callback) t = callback.type;
          if (contract.sameCollection !== undefined && collection) {
            const other = args[contract.sameCollection];
            if (other) {
              if (isCompatible(collection, other, relations)) t = other;
              else compare(other, collection, e.args[contract.sameCollection]);
            }
          }
          if (
            contract.result === 'context' &&
            expected &&
            symbols.get(expected)?.kind === 'concept' &&
            !scalarTypes.includes(expected)
          ) {
            t = expected;
            if (contract.quantity) quantities.add(expected);
          }
        }
        break;
      }
      case 'set': {
        const expectedElement = expected?.startsWith('set{') ? expected.slice(4, -1) : undefined;
        let element = '?';
        for (const a of e.elements) {
          const ty = infer(a, expectedElement ?? (element === '?' ? undefined : element));
          if (element === '?' && ty !== '?') element = ty;
          else if (isCompatible(element, ty, relations)) element = ty;
          else if (!isCompatible(ty, element, relations) && expectedElement)
            element = expectedElement;
        }
        if (element === '?' && expectedElement && expectedElement !== 'Any')
          element = expectedElement;
        t = `set{${element}}`;
        break;
      }
      case 'tuple':
        t = `(${e.elements.map((x) => infer(x)).join(', ')})`;
        break;
      case 'comprehension':
        comprehensions.push(e);
        t = withBody(e.condition, e, () => `set{${infer(e.output)}}`);
        break;
      case 'rule':
        if (e !== topOutput)
          issue(e, 'invalid-expression', 'Rules are only allowed as top-level statements.');
        t = withBody(e.body, e, () => {
          const previous = ruleHead;
          ruleHead = e.conclusion;
          infer(e.conclusion, p.booleanType, true);
          ruleHead = previous;
          return p.booleanType;
        });
        break;
      case 'clauses':
        t = withBody(e, e, () => p.booleanType);
        break;
      case 'unary': {
        if (e.op === p.negationKeyword) {
          if (!formula && !p.assertionValues)
            issue(e, 'assertion-value', 'A logical formula is not a value.');
          infer(e.value, p.booleanType, true);
          t = p.booleanType;
        } else {
          t = infer(e.value);
          if (t !== '?' && !numeric(t))
            issue(e, 'numeric', `Arithmetic is not configured for ${t}.`);
        }
        break;
      }
      case 'binary': {
        if (
          e.op === p.surface.Assign[0] &&
          e.left.kind === 'id' &&
          p.outputNames.includes(e.left.name)
        ) {
          if (e !== topOutput)
            issue(e.left, 'output-scope', 'Output is only allowed at file scope.');
          else if (++outputs > p.maxOutputs)
            issue(e.left, 'multiple-output', `最多允许 ${p.maxOutputs} 个 output。`);
          t = infer(e.right);
          break;
        }
        const category = table.get(e.op)?.category;
        if (category === 'equation') {
          equationDepth++;
          infer(e.left, p.numberLiteralType);
          infer(e.right, p.numberLiteralType);
          equationDepth--;
          t = p.equationType;
          if (global(t)?.kind !== 'concept')
            issue(e, 'unknown-type', `Unknown equation result type '${t}'.`);
          break;
        }
        if (
          ['assertion', 'ordering', 'membership', 'logic'].includes(category ?? '') &&
          !formula &&
          !p.assertionValues
        )
          issue(
            e,
            'assertion-value',
            'A formula is not a value. Use a Bool-returning operator such as is_equal().'
          );
        if (category === 'logic') {
          infer(e.left, p.booleanType, true);
          infer(e.right, p.booleanType, true);
          t = p.booleanType;
          break;
        }
        if (category === 'membership') {
          const domain = infer(e.right);
          const actual = infer(e.left);
          if (domain.startsWith('set{')) {
            const member = domain.slice(4, -1);
            // A membership assertion can narrow a parent object into a subset.
            if (!isCompatible(member, actual, relations)) compare(actual, member, e.left);
            else if (env !== symbols && e.left.kind === 'id' && actual !== member) {
              const bound = lookup(e.left.name);
              if (bound) env.set(e.left.name, { ...bound, type: member });
            }
          } else if (domain !== '?')
            issue(e.right, 'domain', 'Membership requires a concept collection or set value.');
          t = p.booleanType;
          break;
        }
        const known = (x: Expr): string | undefined =>
          x.kind === 'id'
            ? p.conceptSets && lookup(x.name)?.kind === 'concept'
              ? `set{${lookup(x.name)!.type}}`
              : lookup(x.name)?.type
            : x.kind === 'call'
              ? lookup(x.name)?.type
              : x.kind === 'literal'
                ? x.type
                : x.kind === 'binary' && table.get(x.op)?.category === 'equation'
                  ? p.equationType
                  : undefined;
        let left = infer(e.left, known(e.left) ? undefined : known(e.right));
        if (
          e.op === p.surface.Assign[0] &&
          e.left.kind === 'id' &&
          lookup(e.left.name)?.kind === 'concept'
        ) {
          const name = lookup(e.left.name)!.name,
            parent = relations[name]?.find((x) => x !== p.conceptRoot);
          if (parent) left = `set{${parent}}`;
        }
        const memberFact =
          p.elementAssertions &&
          e.op === p.surface.Assign[0] &&
          (e === topOutput || e === ruleHead) &&
          e.left.kind === 'call' &&
          left.startsWith('set{') &&
          known(e.right) &&
          !known(e.right)!.startsWith('set{');
        const right = infer(
          e.right,
          left === '?' ? undefined : memberFact ? left.slice(4, -1) : left
        );
        if (category === 'assertion' || category === 'ordering') t = p.booleanType;
        else t = left === '?' ? right : left;
        if (category === 'arithmetic' || category === 'ordering')
          for (const [ty, node] of [
            [left, e.left],
            [right, e.right]
          ] as const)
            if (ty !== '?' && !numeric(ty))
              issue(node, 'numeric', `Arithmetic/ordering is not configured for ${ty}.`);
        break;
      }
    }
    types.set(e, t);
    if (expected) compare(t, expected, e);
    return t;
  }
  for (const s of program.statements) {
    statementStart = s.start;
    if (s.kind === 'expression') {
      topOutput = s.expression;
      infer(
        s.expression,
        s.expression.kind === 'binary' &&
          s.expression.op === p.surface.Assign[0] &&
          s.expression.left.kind === 'id' &&
          p.outputNames.includes(s.expression.left.name)
          ? undefined
          : p.booleanType,
        true
      );
    } else if (s.initializer) {
      topOutput = undefined;
      initializing = s.name;
      infer(s.initializer, s.type ? typeOf(s.type) : undefined);
      initializing = undefined;
    }
  }
  if (p.declareBuiltIns)
    for (const reference of references) {
      const target = reference.target;
      if (
        !reference.declaration &&
        target &&
        !target.declaration &&
        ['concept', 'operator'].includes(target.kind) &&
        (!target.origin || target.origin.uri === 'language/core.keh')
      )
        issue(
          { start: reference.start, end: reference.end },
          'builtin-declaration',
          `Declare built-in '${reference.name}' before use.`
        );
    }
  for (const d of issues)
    if (d.fix) {
      const matches = issues.filter(
        (x) => x.code === 'undeclared' && source.slice(x.start, x.end) === d.fix!.name
      );
      if (matches.some((x) => !x.fix || x.fix.type !== d.fix!.type) || d.fix.type.includes('?'))
        delete d.fix;
    }
  return {
    program,
    symbols,
    references,
    issues,
    types,
    comprehensions,
    scopes,
    compatibility: relations
  };
}
export const displayType = (type: string) =>
  type
    .replace(/set\{/g, defaults.keywords.set + defaults.surface.CallOpen[0])
    .replaceAll('}', defaults.surface.CallClose[0]);
export function signature(s: Symbol, p: Profile = defaults): string {
  const colon = p.surface.Colon[0];
  return s.kind === 'concept'
    ? `${p.keywords.concept} ${s.name}${s.declaration?.parent ? ' ' + p.surface.Subtype[0] + ' ' + typeName(s.declaration.parent) : ''}`
    : `${s.kind === 'object' ? p.variableKeyword : p.keywords.constant} ${s.name} ${colon} ${displayType(s.type)}`;
}
