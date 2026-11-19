import { AstUtils, CstUtils, GrammarUtils } from 'langium';
import type { Binding, Declaration, Expr, Program, Span, Token, TypeRef } from './ast';
import { defaults, Profile, SeparatorRole, BinaryOperator } from './profile';

export const tupleConstructors: readonly string[] = ['tuple', 'tupleof'];
const isTupleConstructor = (name: string): boolean => tupleConstructors.includes(name);
let services: any;
export const syntaxServices = () => services;
const roles: Record<string, SeparatorRole> = {
  StatementSeparator: 'statement',
  ArgumentSeparator: 'argument',
  RuleSeparator: 'condition',
  ConditionSeparator: 'condition',
  SetSeparator: 'setElement',
  TupleSeparator: 'tupleElement'
};
export const span = (node: any): Span => ({
  start: node?.$cstNode?.offset ?? 0,
  end: node?.$cstNode?.end ?? 0
});
const propertySpan = (node: any, property: string): Span => {
  const cst = GrammarUtils.findNodeForProperty(node?.$cstNode, property);
  return cst ? { start: cst.offset, end: cst.end } : span(node);
};
export function initializeSyntax(value: any) {
  services = value;
  const keywords = (rule: any, seen = new Set<any>()): string[] => {
    if (seen.has(rule)) return [];
    const next = new Set(seen).add(rule);
    return AstUtils.streamAllContents(rule)
      .flatMap((n: any) =>
        n.$type === 'Keyword'
          ? [n.value]
          : n.$type === 'RuleCall' && n.rule.ref?.dataType
            ? keywords(n.rule.ref, next)
            : []
      )
      .toArray();
  };
  for (const rule of services.Grammar.rules) {
    defaults.surface[rule.name] = [...new Set(keywords(rule))];
  }
  const first = (name: string) => defaults.surface[name]?.[0] ?? '';
  defaults.keywords = {
    concept: first('ConceptKeyword'),
    constant: first('ConstantKeyword'),
    set: first('SetKeyword'),
    true: first('BooleanKeyword'),
    false: defaults.surface.BooleanKeyword[1]
  };
  defaults.operatorAliases = defaults.surface.OperatorKeyword;
  defaults.variableKeyword = first('VariableKeyword');
  defaults.negationKeyword = first('NegationOperator');
  for (const [name, role] of Object.entries(roles)) defaults.style[role] = first(name);
  defaults.style.final = defaults.style.statement;
  // Categories describe meaning; precedence is solely in ke.langium.
  const categories: Record<string, BinaryOperator['category']> = {
    OrOperator: 'logic',
    AndOperator: 'logic',
    EquationOperator: 'equation',
    AddOperator: 'arithmetic',
    MultiplyOperator: 'arithmetic',
    PowerOperator: 'arithmetic',
    Colon: 'membership',
    AssertionOperator: 'assertion',
    OrderingOperator: 'ordering'
  };
  defaults.binaryOperators = Object.fromEntries(
    Object.entries(categories).flatMap(([rule, category]) =>
      defaults.surface[rule].map((op) => [op, { category }])
    )
  );
}

export function lex(source: string) {
  const result = services.parser.Lexer.tokenize(source);
  const tokens: Token[] = [...result.tokens, ...result.hidden]
    .map(
      (t: any): Token => ({
        start: t.startOffset,
        end: t.endOffset + 1,
        text: t.image,
        kind:
          t.tokenType.name === 'NUMBER'
            ? 'number'
            : t.tokenType.name === 'STRING'
              ? 'string'
              : t.tokenType.name === 'COMMENT'
                ? 'comment'
                : t.tokenType.name === 'ID'
                  ? 'id'
                  : 'punct'
      })
    )
    .sort((a, b) => a.start - b.start);
  // Keyword tokens that may be used as names retain their identity for tooling.
  for (const t of tokens)
    if (/^[_\p{L}][_\p{L}\p{N}]*$/u.test(t.text) && t.kind === 'punct') t.kind = 'id';
  tokens.push({ start: source.length, end: source.length, text: '', kind: 'eof' });
  return {
    tokens,
    issues: result.errors.map((e: any) => ({
      start: e.offset,
      end: e.offset + e.length,
      code: 'syntax',
      message: e.message
    }))
  };
}

/** Lower one grammar AST to the semantic model. No reparsing or fallback grammar. */
export function parse(source: string, p: Profile = defaults): Program {
  const parsed = services.parser.LangiumParser.parse(source);
  const lexical = lex(source);
  const program: Program = {
    statements: [],
    tokens: lexical.tokens,
    issues: lexical.issues,
    delimiters: []
  };
  for (const error of parsed.parserErrors) {
    const start = Number.isFinite(error.token.startOffset)
      ? error.token.startOffset
      : source.length;
    program.issues.push({
      start,
      end: Math.min(source.length, start + (error.token.image?.length || 0)),
      code: 'syntax',
      message: error.message
    });
  }
  if (parsed.value.$cstNode)
    for (const leaf of CstUtils.flattenCst(parsed.value.$cstNode)) {
      let rule: any = leaf.grammarSource;
      while (rule && !roles[rule.name]) rule = rule.$container;
      if (!rule) continue;
      const role = roles[rule.name],
        wanted = p.surface[rule.name][0];
      program.delimiters.push({ start: leaf.offset, end: leaf.end, role });
      if (leaf.text !== wanted)
        program.issues.push({
          start: leaf.offset,
          end: leaf.end,
          code: 'separator',
          message: `此处使用 ${wanted}`,
          replacement: wanted
        });
    }
  const type = (n: any): TypeRef => {
    if (n?.element) return { name: 'set', element: type(n.element), ...span(n) };
    if (n?.$type === 'AppliedType') {
      if (isTupleConstructor(n.name))
        return { name: 'tuple', elements: (n.elements ?? []).map(type), ...span(n) };
      program.issues.push({
        ...propertySpan(n, 'name'),
        code: 'syntax',
        message: '类型位置只接受概念名称、set(...) 或 tuple(...)。'
      });
      return { name: '?', ...span(n) };
    }
    return { name: n?.name || '?', ...span(n) };
  };
  const asType = (e: Expr): TypeRef | undefined => {
    if (e.kind === 'id') return { name: e.name, start: e.start, end: e.end };
    if (e.kind === 'call' && e.name === p.keywords.set && e.args.length === 1) {
      const element = asType(e.args[0]);
      if (element) return { name: 'set', element, start: e.start, end: e.end };
    }
    if (e.kind === 'call' && isTupleConstructor(e.name) && e.args.length) {
      const elements = e.args.map(asType);
      if (elements.every((element): element is TypeRef => element !== undefined))
        return { name: 'tuple', elements, start: e.start, end: e.end };
    }
  };
  const missing = (n: any): Expr => ({ kind: 'id', name: '?', ...span(n) });
  const clauses = (n: any): Expr => {
    const bindings: Binding[] = [],
      conditions: Expr[] = [],
      seen = new Set<string>();
    for (const item of n?.items ?? []) {
      const explicit = item.$type === 'LocalBinding';
      const converted = explicit ? undefined : expr(item);
      const left =
        converted?.kind === 'binary' && converted.op === p.surface.Colon[0]
          ? converted.left
          : undefined;
      const name = explicit ? item.name : left?.kind === 'id' ? left.name : undefined;
      if (name && (explicit || !seen.has(name))) {
        const domain = explicit ? expr(item.domain) : (converted as any).right;
        const ty = asType(domain);
        bindings.push({
          name,
          nameSpan: explicit ? propertySpan(item, 'name') : left!,
          type: ty,
          domain: ty ? undefined : domain,
          constant: explicit && item.keyword === p.keywords.constant,
          ...span(item)
        });
        seen.add(name);
      } else if (converted) conditions.push(converted);
    }
    return { kind: 'clauses', bindings, conditions, ...span(n) };
  };
  const expr = (n: any): Expr => {
    if (!n) return missing(n);
    const s = span(n);
    switch (n.$type) {
      case 'NumberLiteral':
      case 'StringLiteral':
      case 'BooleanLiteral':
        return {
          kind: 'literal',
          value: n.$cstNode?.text || '',
          type:
            n.$type === 'NumberLiteral'
              ? p.numberLiteralType
              : n.$type === 'StringLiteral'
                ? p.stringLiteralType
                : p.booleanType,
          ...s
        };
      case 'NamedExpression': {
        const nameSpan = propertySpan(n, 'name');
        const tail = source.slice(nameSpan.end, s.end).trimStart();
        if (tail.startsWith(p.surface.CallOpen[0]) || tail.startsWith(p.surface.ProjectionOpen[0]))
          return {
            kind: 'call',
            name: n.name || '?',
            nameSpan,
            args: (n.args ?? []).map(expr),
            projection: !!n.projection,
            ...s
          };
        return { kind: 'id', name: n.name || '?', ...s };
      }
      case 'Binary':
        return { kind: 'binary', op: n.op, left: expr(n.left), right: expr(n.right), ...s };
      case 'UnaryExpression':
      case 'NegationExpression':
        return { kind: 'unary', op: n.op, value: expr(n.value), ...s };
      case 'Group':
        return n.elements?.length === 1 && !n.trailing
          ? { ...expr(n.elements[0]), grouped: true, ...s }
          : { kind: 'tuple', elements: (n.elements ?? []).map(expr), ...s };
      case 'SetExpression':
        if (n.clauses) {
          if (n.elements?.length !== 1)
            program.issues.push({
              ...s,
              code: 'syntax',
              message: '集合推导只接受一个输出表达式，多列请使用元组。'
            });
          return {
            kind: 'comprehension',
            output: expr(n.elements?.[0]),
            condition: clauses(n.clauses),
            ...s
          };
        }
        return { kind: 'set', elements: (n.elements ?? []).map(expr), ...s };
      case 'RuleExpression':
        return { kind: 'rule', conclusion: expr(n.conclusion), body: clauses(n.body), ...s };
      default:
        return missing(n);
    }
  };
  const declared = new Set([...Object.keys(p.values)]);
  for (const n of parsed.value.statements ?? []) {
    if (n.$type === 'ExpressionStatement') {
      const e = expr(n.expression);
      if (e.kind === 'binary' && e.left.kind === 'id') {
        if (e.op === p.surface.Subtype[0]) {
          const parent = asType(e.right);
          if (parent) {
            program.statements.push({
              kind: 'concept',
              name: e.left.name,
              nameSpan: e.left,
              parent,
              params: [],
              ...span(n)
            });
            continue;
          }
        }
        if (e.op === p.surface.Colon[0] && !declared.has(e.left.name)) {
          const init =
            e.right.kind === 'binary' && e.right.op === p.surface.Assign[0] ? e.right : undefined;
          const ty = asType(init ? init.left : e.right);
          if (ty) {
            program.statements.push({
              kind: 'constant',
              name: e.left.name,
              nameSpan: e.left,
              type: ty,
              params: [],
              initializer: init?.right,
              ...span(n)
            });
            declared.add(e.left.name);
            continue;
          }
        }
      }
      program.statements.push({ kind: 'expression', expression: e, ...span(n) });
      continue;
    }
    if (!n.name) continue;
    const d: Declaration = {
      kind:
        n.$type === 'ConceptDeclaration'
          ? 'concept'
          : n.$type === 'OperatorDeclaration'
            ? 'operator'
            : 'constant',
      name: n.name,
      nameSpan: propertySpan(n, 'name'),
      params: [],
      ...span(n)
    };
    if (d.kind === 'concept') {
      d.parent = n.parent
        ? type(n.parent)
        : n.setParent?.element
          ? type(n.setParent.element)
          : undefined;
      if (n.setParent) {
        d.parentForm = 'set';
        if (!n.setParent.element)
          program.issues.push({
            ...span(n.setParent),
            code: 'syntax',
            message: '子概念声明需使用集合类型。'
          });
      }
    } else {
      d.type = type(n.type);
      d.params = (n.parameters ?? []).map((v: any) => type(v.type));
      d.parameterNames = (n.parameters ?? []).map((v: any) => v.name || '');
      if (n.initializer) d.initializer = expr(n.initializer);
      declared.add(d.name);
    }
    program.statements.push(d);
  }
  return program;
}
