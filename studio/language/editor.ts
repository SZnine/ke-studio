import { TextDocument } from 'vscode-languageserver-textdocument';
import { Analysis, displayType, signature, signatures, globalSymbols, Symbol, typeName } from './semantic';
import { Profile, isNumericType, operatorTable } from './profile';
import * as parser from './parser';
import { completionSearchRank } from './completion-search';
import { isCompatible, sameParameters } from './types';
import type { Token } from './ast';
import { pendingBindings, clauseContinuation, finishCompletion } from './completion-edits';
import { diagnostics } from './diagnostics';

export const tokenTypes = [
  'keyword',
  'type',
  'function',
  'variable',
  'number',
  'string',
  'comment',
  'operator'
];
export interface CompletionOptions {
  enabled?: boolean;
  manual?: boolean;
  callStyle?: 'smart' | 'name' | 'parentheses' | 'arguments';
  onEnter?: boolean;
}
const esc = (text: string) => text.replace(/[\\$}]/g, '\\$&');
const display = (type: string, p: Profile) => displayType(type);
const order = (group: number, rank = 0, origin = 0, usage = 0) =>
  `${group}${String(rank).padStart(5, '0')}${origin}${String(999999 - Math.min(usage, 999999)).padStart(6, '0')}`;
export function describeSignature(s: Symbol, p: Profile) {
  let label = s.name + p.surface.CallOpen[0];
  const parameters = s.params.map((type, i) => {
    if (i) label += p.style.argument + ' ';
    const start = label.length;
    label += `${s.parameterNames?.[i] || `arg${i + 1}`} ${p.surface.Colon[0]} ${display(type, p)}`;
    return { label: [start, label.length], documentation: s.parameterDescriptions?.[i] || '' };
  });
  label += `${p.surface.CallClose[0]} ${p.surface.Colon[0]} ${display(s.type, p)}`;
  return {
    label,
    parameters,
    documentation: [s.description, s.returnDescription].filter(Boolean).join('\n')
  };
}

/** Declarations use CO input/output types; parameter names remain visible in signature help. */
export function describeDeclaration(s: Symbol, p: Profile) {
  const params = s.params.map((type) => display(type, p)).join(p.style.argument + ' ');
  return `${s.name}${p.surface.CallOpen[0]}${params}${p.surface.CallClose[0]} ${p.surface.Colon[0]} ${display(s.type, p)}`;
}

/** The grammar owns delimiters. Nested calls, sets and tuples cannot advance an outer argument. */
function callAt(a: Analysis, offset: number, p: Profile) {
  const s = p.surface;
  const opens = new Map([
    [s.CallOpen[0], s.CallClose[0]],
    [s.SetOpen[0], s.SetClose[0]],
    [s.ProjectionOpen[0], s.ProjectionClose[0]]
  ]);
  const frames: { close: string; name?: string; index: number; start: number; args: Token[][] }[] =
    [];
  const tokens = a.program.tokens.filter(
    (t) => t.end <= offset && !['comment', 'eof'].includes(t.kind)
  );
  for (const [i, token] of tokens.entries()) {
    for (const frame of frames)
      if (!(frame === frames.at(-1) && token.text === p.style.argument))
        frame.args.at(-1)!.push(token);
    if (opens.has(token.text)) {
      const previous = tokens[i - 1];
      frames.push({
        close: opens.get(token.text)!,
        name:
          [s.CallOpen[0], s.ProjectionOpen[0]].includes(token.text) &&
          previous?.kind === 'id' &&
          !p.operatorAliases.includes(tokens[i - 2]?.text)
            ? previous.text
            : undefined,
        index: 0,
        start: token.end,
        args: [[]]
      });
    } else if (frames.at(-1)?.close === token.text) {
      frames.pop();
    } else {
      const frame = frames.at(-1);
      if (!frame) continue;
      if (token.text === p.style.argument && frame.name) {
        frame.index++;
        frame.args.push([]);
      }
    }
  }
  const frame = frames.at(-1);
  if (!frame?.name) return;
  const symbol = a.symbols.get(p.symbolAliases.operators[frame.name] || frame.name);
  if (symbol?.kind !== 'operator') return;
  const choices = signatures(symbol);
  const actualType = (tokens: Token[]) => {
    const start = tokens[0]?.start,
      end = tokens.at(-1)?.end;
    for (const [expr, type] of a.types) if (expr.start === start && expr.end === end) return type;
    const t = tokens[0];
    if (tokens.length !== 1) return '?';
    return t.kind === 'number'
      ? p.numberLiteralType
      : t.kind === 'string'
        ? p.stringLiteralType
        : a.symbols.get(t.text)?.type || '?';
  };
  const score = (choice: Symbol) =>
    frame.args.reduce(
      (total, tokens, i) =>
        total +
        (i >= choice.params.length
          ? -10
          : tokens.length &&
              isCompatible(actualType(tokens), choice.params[i], a.compatibility, false)
            ? 3
            : 0),
      0
    );
  const activeSignature = choices.reduce(
    (best, choice, i) => (score(choice) > score(choices[best]) ? i : best),
    0
  );
  return { frame, choices, activeSignature };
}

export async function inspect(
  source: string,
  offset: number,
  a: Analysis,
  p: Profile,
  options: CompletionOptions = {},
  discovery?: Profile
) {
  offset = Math.max(0, Math.min(offset, source.length));
  const symbols = new Map(a.symbols);
  for (const scope of a.scopes)
    if (scope.span.start <= offset && offset <= scope.span.end)
      for (const [name, s] of scope.symbols) symbols.set(name, s);
  const blocked = a.program.tokens.some(
    (t) => (t.kind === 'comment' || t.kind === 'string') && t.start < offset && offset <= t.end
  );
  const word = a.program.tokens.find(
    (t) => t.kind === 'id' && t.start <= offset && offset <= t.end
  );
  const prefix = word ? source.slice(word.start, offset) : '';
  const replace = word ? { start: word.start, end: word.end } : { start: offset, end: offset };
  const before = a.program.tokens.filter(
    (t) => t.end <= replace.start && !['comment', 'eof'].includes(t.kind)
  );
  const previous = before.at(-1);
  const opens = new Set([p.surface.CallOpen[0], p.surface.SetOpen[0], p.surface.ProjectionOpen[0]]);
  const closes = new Set([
    p.surface.CallClose[0],
    p.surface.SetClose[0],
    p.surface.ProjectionClose[0]
  ]);
  const frames: { token: Token; name?: string; filtered: boolean; index: number }[] = [];
  for (const [i, token] of before.entries()) {
    if (opens.has(token.text))
      frames.push({ token, name: before[i - 1]?.text, filtered: false, index: 0 });
    else if (closes.has(token.text)) frames.pop();
    else if (p.surface.Filter.includes(token.text) && frames.at(-1)) frames.at(-1)!.filtered = true;
    else if (p.surface.ArgumentSeparator.includes(token.text) && frames.at(-1))
      frames.at(-1)!.index++;
  }
  const frame = frames.at(-1);
  const depth = frames.length;
  const call = callAt({ ...a, symbols }, offset, p);
  const tupleConstructors = p.surface.AppliedType ? (parser.tupleConstructors ?? []) : [];
  const typeConstructors = [...p.surface.SetKeyword, ...tupleConstructors];
  const insideConstructedType =
    !!frame &&
    p.surface.CallOpen.includes(frame.token.text) &&
    typeConstructors.includes(frame.name || '') &&
    (!call || frames.some((opened) => p.surface.SetKeyword.includes(opened.name || '')));
  const statementStart =
    !depth && (!previous || p.surface.StatementSeparator.includes(previous.text));
  const next = a.program.tokens.find(
    (t) => t.start >= replace.end && !['comment', 'eof'].includes(t.kind)
  );
  const completions: any[] = [];
  const descriptionMatches: any[] = [];
  const services = parser.syntaxServices();
  const smart = options.callStyle === 'smart';
  if (!blocked && options.enabled !== false) {
    // Completion only needs text positions; constructing a LangiumDocument reparses the whole file.
    const document = TextDocument.create('memory:/completion.ke', 'ke', 0, source);
    const provider = services.lsp.CompletionProvider;
    // Langium computes viable grammar features at the cursor, including incomplete input.
    const features = provider.findFeaturesAt(document, replace.start);
    const nameSlots = features
      .filter((f: any) => f.feature.$type === 'RuleCall' && f.feature.rule.ref?.name === 'ID')
      .map((f: any) => {
        let node = f.feature;
        while (node && node.$type !== 'ParserRule') node = node.$container;
        return node?.name;
      });
    // Membership domains are expressions in the grammar. Their constructors take types.
    const inType = insideConstructedType || nameSlots.includes('NamedType');
    const declarationName =
      p.surface.ConceptKeyword.includes(previous?.text || '')
        ? 'ConceptDeclaration'
        : p.operatorAliases.includes(previous?.text || '')
          ? 'OperatorDeclaration'
          : previous?.text === p.keywords.constant
            ? 'ConstantDeclaration'
            : undefined;
    const domainPosition =
      inType || [...p.surface.Colon, ...p.surface.Subtype].includes(previous?.text || '');
    const typeKeywords = new Set([...typeConstructors, ...(p.surface.NamedType || [])]);
    const constructorPrefix =
      domainPosition && !!prefix && typeConstructors.some((name) => name.startsWith(prefix));
    const clauseGap =
      !prefix &&
      !!frame?.filtered &&
      p.surface.SetOpen.includes(frame.token.text) &&
      p.surface.ConditionSeparator.includes(previous?.text || '');
    const clauseStart =
      !!frame?.filtered &&
      p.surface.SetOpen.includes(frame.token.text) &&
      [...p.surface.ConditionSeparator, ...p.surface.Filter].includes(previous?.text || '');
    const declaration = a.program.statements.find(
      (statement) =>
        statement.kind === 'operator' &&
        statement.start <= replace.start &&
        (replace.start <= statement.end || !source.slice(statement.end, replace.start).trim())
    );
    const knownOperator =
      declaration && declaration.kind === 'operator'
        ? globalSymbols(p).get(declaration.name)
        : undefined;
    const returnPosition =
      smart &&
      domainPosition &&
      !frames.length &&
      declaration?.kind === 'operator' &&
      knownOperator?.kind === 'operator';
    const parameterPosition =
      smart &&
      inType &&
      declaration?.kind === 'operator' &&
      frame?.name === declaration.name &&
      knownOperator?.kind === 'operator';
    if (knownOperator && (returnPosition || parameterPosition)) {
      for (const choice of signatures(knownOperator)) {
        const type = returnPosition ? choice.type : choice.params[frame!.index];
        if (!type) continue;
        const name = display(type, p);
        if (
          !name.toLowerCase().startsWith(prefix.toLowerCase()) ||
          completions.some((item) => item.name === name)
        )
          continue;
        completions.push({
          name,
          kind: 'type',
          detail: returnPosition ? 'CO 返回类型' : 'CO 参数类型',
          insert: name,
          completeReturn: returnPosition,
          replace,
          filter: prefix || name,
          sort: order(0, 0, 0, 999999)
        });
      }
    }
    if (smart && clauseStart) {
      for (const item of pendingBindings(a, offset, symbols)) {
        if (!item.name.toLowerCase().startsWith(prefix.toLowerCase())) continue;
        completions.push({
          name: item.name,
          kind: 'value',
          detail: '声明输出中尚未绑定的变量',
          insert:
            item.name +
            ' ' +
            p.surface.Colon[0] +
            ' ${1' +
            (item.type ? ':' + esc(item.type) : '') +
            '}$0',
          snippet: true,
          suggest: true,
          replace,
          filter: prefix || item.name,
          sort: order(0, 0, 0, 999999)
        });
      }
    }
    const operator = operatorTable(p).get(previous?.text || '');
    const leftEnd = before.at(-2)?.end;
    const leftTypes = [...a.types]
      .filter(([expression]) => expression.end === leftEnd)
      .sort(([a], [b]) => a.start - b.start);
    const leftType = leftTypes[0]?.[1] || symbols.get(before.at(-2)?.text || '')?.type;
    const numericOperand = operator?.category === 'arithmetic' || operator?.category === 'ordering';
    const isNumeric = a.isNumeric ?? ((type: string) =>
      isNumericType(type, p) || isCompatible(type, p.numberLiteralType, a.compatibility, false));
    const expected =
      numericOperand
        ? undefined
        : operator?.category === 'assertion' && leftType !== '?'
          ? leftType
          : call?.choices[call.activeSignature].params[call.frame.index];
    const declarationStarts = [
      p.keywords.concept,
      p.operatorAliases[0],
      p.keywords.constant
    ];
    const starts = [...declarationStarts, ...p.outputNames];
    const declarationPrefix =
      statementStart && starts.some((name) => name.toLowerCase().startsWith(prefix.toLowerCase()));
    const arithmeticGap = !prefix && operator?.category === 'arithmetic';
    const editingNumber = a.program.tokens.some(
      (t) => t.kind === 'number' && t.start < offset && offset <= t.end
    );
    const candidates = declarationName ? globalSymbols(p) : symbols;
    const discoveredNames = new Set<string>();
    if (discovery && declarationName !== undefined)
      for (const [name, symbol] of globalSymbols(discovery)) {
        if (symbols.has(name) || candidates.has(name)) continue;
        candidates.set(name, symbol);
        discoveredNames.add(name);
      }
    for (const symbol of candidates.values()) {
      if (!nameSlots.length && !declarationName && !inType) continue;
      if (nameSlots.includes('LocalBinding')) continue;
      if (declarationName === 'ConstantDeclaration') continue;
      if (declarationName === 'ConceptDeclaration' && symbol.kind !== 'concept') continue;
      if (
        declarationName === 'ConceptDeclaration' &&
        a.program.statements.some(
          (s) =>
            s.kind === 'concept' &&
            s.name === symbol.name &&
            (s.nameSpan.end < replace.start || s.nameSpan.start > replace.end)
        )
      )
        continue;
      if (declarationName === 'OperatorDeclaration' && symbol.kind !== 'operator') continue;
      if (!declarationName && inType && symbol.kind !== 'concept') continue;
      // Respect global declaration order, but keep local bindings visible in the output/head.
      if (
        p.declarationOrder &&
        symbol.declaration &&
        symbol.declaration.start > offset &&
        a.symbols.get(symbol.name) === symbol
      )
        continue;
      const named = symbol.declaration?.nameSpan;
      if (!declarationName && named && named.start <= offset && offset <= named.end) continue;
      if (!options.manual && (arithmeticGap || editingNumber || clauseGap)) continue;
      if (statementStart && (!prefix || declarationPrefix)) continue;
      // A type name belongs in a declaration/domain, not among ordinary expression values.
      if (
        !declarationName &&
        !domainPosition &&
        symbol.kind === 'concept' &&
        !expected?.startsWith('set{')
      )
        continue;
      if (domainPosition && symbol.kind !== 'concept' && !symbol.type.startsWith('set{')) continue;
      const core = !symbol.origin || symbol.origin.uri === 'language/core.keh';
      if (!options.manual && !prefix) {
        if (declarationName && core) continue;
        if (!declarationName && !domainPosition && !symbol.declaration && !symbol.usage) continue;
      }
      const choices = signatures(symbol);
      for (const choice of choices) {
        const discovered = discoveredNames.has(choice.name);
        if (declarationName === 'OperatorDeclaration' && a.program.statements.some((declaration) =>
          declaration.kind === 'operator' && declaration.name === choice.name &&
          (declaration.nameSpan.end < replace.start || declaration.nameSpan.start > replace.end) &&
          sameParameters(declaration.params.map(typeName), choice.params, a.compatibility)))
          continue;
        if ((expected || numericOperand) && !domainPosition && !declarationName) {
          const actual =
            choice.kind === 'concept'
              ? `set{${choice.type}}`
              : choice.kind === 'operator' && expected === 'operator'
                ? 'operator'
                : choice.type;
          if (numericOperand && !isNumeric(actual)) continue;
          if (expected && !isCompatible(actual, expected, a.compatibility, false)) continue;
        }
        const sourceProfile = discovered ? discovery! : p;
        const formal = choice.kind === 'concept'
          ? sourceProfile.symbolAliases.concepts
          : sourceProfile.symbolAliases.operators;
        const aliases = [
          choice.label || '',
          ...(choice.aliases || []),
          ...Object.entries(formal)
            .filter(([, target]) => target === choice.name)
            .map(([name]) => name)
        ];
        const directRank = completionSearchRank(prefix, choice.name, aliases, []);
        const rank =
          directRank >= 0
            ? directRank
            : completionSearchRank(prefix, choice.name, aliases, [choice.description || '']);
        if (rank < 0) continue;
        let insert = choice.name,
          snippet = false,
          completeDeclaration = declarationName === 'ConceptDeclaration';
        if (choice.kind === 'operator') {
          if (declarationName && !p.surface.CallOpen.includes(next?.text || '')) {
            insert = describeDeclaration(choice, p);
            completeDeclaration = true;
          } else if (
            !declarationName &&
            expected !== 'operator' &&
            options.callStyle &&
            options.callStyle !== 'name' &&
            ![...p.surface.CallOpen, ...p.surface.ProjectionOpen].includes(next?.text || '')
          ) {
            const args =
              options.callStyle === 'arguments' || smart
                ? choice.params
                    .map(
                      (_, i) =>
                        '${' +
                        (i + 1) +
                        (smart ? '' : ':' + esc(choice.parameterNames?.[i] || `arg${i + 1}`)) +
                        '}'
                    )
                    .join(p.style.argument + ' ')
                : '$0';
            insert += p.surface.CallOpen[0] + args + p.surface.CallClose[0];
            snippet = true;
          }
        }
        let suggest = smart && snippet;
        if (discovered && !completeDeclaration) continue;
        if (
          smart &&
          call &&
          !declarationName &&
          !domainPosition &&
          choice.kind !== 'operator' &&
          call.choices.every((s) => s.params.length > call.frame.index + 1) &&
          call.frame.args[call.frame.index].every(
            (t) => replace.start <= t.start && t.end <= replace.end
          ) &&
          (!next || p.surface.CallClose.includes(next.text))
        ) {
          insert += p.style.argument + ' ';
          suggest = true;
        }
        if (
          choice.kind === 'concept' &&
          completions.some((item) => item.kind === 'type' && item.name === choice.name)
        )
          continue;
        const origin = choice.declaration
          ? 0
          : discovered
            ? 3
            : choice.origin && choice.origin.uri !== 'language/core.keh'
            ? 1
            : 2;
        (directRank < 0 ? descriptionMatches : completions).push({
          name: choice.name,
          label: choice.label,
          detail:
            choice.kind === 'operator'
              ? describeSignature(choice, p).label
              : display(choice.type, p),
          kind:
            choice.kind === 'concept' ? 'type' : choice.kind === 'operator' ? 'operator' : 'value',
          insert,
          completeDeclaration,
          snippet,
          suggest,
          replace,
          // Let the language service own matching/ranking, including pinyin aliases.
          filter: prefix || choice.name,
          sort: order(
            constructorPrefix ||
              (!prefix && !declarationName && !domainPosition && choice.kind === 'operator')
              ? 1
              : 0,
            rank,
            origin,
            choice.usage
          ),
          documentation: choice.description,
          catalogDeclaration: discovered ? {
            kind: choice.kind === 'operator' ? 'operator' : 'concept',
            name: choice.name,
            type: choice.type,
            params: choice.params,
            position: previous!.start
          } : undefined
        });
      }
    }
    if (!declarationName) {
      const keywords = new Set<string>();
      for (const { feature } of features)
        if (feature.$type === 'Keyword') keywords.add(feature.value);
      if (domainPosition && tupleConstructors[0]) keywords.add(tupleConstructors[0]);
      // With an optional final terminator, a partial declaration keyword can
      // parse as a finished expression. Restore declaration choices at its start.
      if (statementStart)
        for (const name of declarationStarts) keywords.add(name);
      for (const name of keywords) {
        if (inType && !typeKeywords.has(name)) continue;
        if (
          !/^[_\p{L}]/u.test(name) ||
          !name.toLowerCase().startsWith(prefix.toLowerCase()) ||
          completions.some((c) => c.name === name)
        )
          continue;
        if (!options.manual) {
          if (arithmeticGap || editingNumber || clauseGap) continue;
          if (statementStart && !starts.includes(name)) continue;
          if (!statementStart && !prefix && !domainPosition) continue;
          if (p.operatorAliases.includes(name) && name !== p.operatorAliases[0]) continue;
        }
        const typeConstructor = domainPosition && typeConstructors.includes(name);
        const snippet = typeConstructor && !p.surface.CallOpen.includes(next?.text || '');
        completions.push({
          name,
          detail: '语法',
          kind: 'keyword',
          insert: name + (snippet ? p.surface.CallOpen[0] + '$0' + p.surface.CallClose[0] : ''),
          snippet,
          replace,
          filter: prefix || name,
          sort: order(
            statementStart || (typeConstructor && constructorPrefix) ? 0 : 2,
            Math.max(0, starts.indexOf(name))
          )
        });
      }
    }
    if (statementStart)
      for (const name of p.outputNames)
        if (
          name.startsWith(prefix) &&
          !a.program.statements.some(
            (s) =>
              s.kind === 'expression' &&
              s.expression.kind === 'binary' &&
              s.expression.left.kind === 'id' &&
              s.expression.left.name === name
          )
        )
          completions.push({
            name,
            detail: '输出',
            kind: 'keyword',
            insert: name,
            replace,
            filter: prefix || name,
            sort: order(0)
          });
    if (!completions.length) completions.push(...descriptionMatches);
    for (const item of completions)
      if (smart || item.completeDeclaration || item.completeReturn)
        finishCompletion(source, item, a, p);
    if (
      p.surface.Colon.includes(previous?.text || '') &&
      previous!.start > 0 &&
      !/\s/.test(source[previous!.start - 1])
    )
      for (const item of completions)
        item.edits = [
          ...(item.edits || []),
          { start: previous!.start, end: previous!.start, text: ' ' }
        ];
    completions.sort((a, b) => a.sort.localeCompare(b.sort) || a.name.localeCompare(b.name));
  }
  const keywords = new Set(
    Object.values(p.surface)
      .flat()
      .filter((t) => /^[_\p{L}]/u.test(t))
  );
  const operators = operatorTable(p);
  const targets = new Map(a.references.map((r) => [r.start, r.target]));
  const highlights = a.program.tokens.flatMap((t) => {
    const s = targets.get(t.start) || a.symbols.get(t.text);
    const type = ['number', 'string', 'comment'].includes(t.kind)
      ? t.kind
      : operators.has(t.text)
        ? 'operator'
        : keywords.has(t.text) || p.outputNames.includes(t.text)
          ? 'keyword'
          : s?.kind === 'concept'
            ? 'type'
            : s?.kind === 'operator'
              ? 'function'
              : s
                ? 'variable'
                : undefined;
    return type ? [{ ...t, type }] : [];
  });
  const reference = a.references.find((r) => r.start <= offset && offset <= r.end && r.target);
  return {
    continuationEdits: smart && options.onEnter ? clauseContinuation(source, offset, a, p) : [],
    issues: diagnostics(a, p),
    highlights,
    completions,
    signature: call && {
      activeSignature: call.activeSignature,
      activeParameter: call.frame.index,
      signatures: call.choices.map((s) => describeSignature(s, p))
    },
    hover: reference && {
      start: reference.start,
      end: reference.end,
      label:
        reference.target!.kind === 'operator'
          ? describeSignature(reference.target!, p).label
          : signature(reference.target!),
      description: [reference.target!.label, reference.target!.description]
        .filter(Boolean)
        .join('\n\n')
    }
  };
}

/** Format whitespace only. Token text, including all string punctuation, stays intact. */
export function format(source: string, a: Analysis, p: Profile) {
  const tokens = a.program.tokens.filter((t) => t.kind !== 'eof');
  const breaks = new Set(
    a.program.delimiters
      .filter((d) => ['statement', 'condition'].includes(d.role))
      .map((d) => d.start)
  );
  const s = p.surface,
    open = new Set([s.CallOpen[0], s.GroupOpen[0], s.ProjectionOpen[0], s.SetOpen[0]]),
    close = new Set([s.CallClose[0], s.GroupClose[0], s.ProjectionClose[0], s.SetClose[0]]),
    separators = new Set(Object.values(p.style));
  let result = '',
    depth = 0;
  for (const [i, t] of tokens.entries()) {
    const previous = tokens[i - 1];
    if (t.text === s.SetClose[0]) depth = Math.max(0, depth - 1);
    if (previous) {
      const gap = source.slice(previous.end, t.start);
      // Invalid characters belong to the user's text, not to the formatter.
      if (/\S/.test(gap)) result += gap;
      else if (
        previous.kind === 'comment' ||
        /[\r\n]/.test(gap) ||
        breaks.has(previous.start) ||
        previous.text === s.Filter[0]
      )
        result += '\n' + '  '.repeat(depth);
      else if (
        !close.has(t.text) &&
        !separators.has(t.text) &&
        !open.has(previous.text) &&
        ![s.CallOpen[0], s.ProjectionOpen[0]].includes(t.text)
      )
        result += ' ';
    } else result += source.slice(0, t.start).replace(/\s+$/, '');
    result += t.text;
    if (t.text === s.SetOpen[0]) depth++;
  }
  return result + (tokens.length ? source.slice(tokens.at(-1)!.end) : source);
}
