import {
  AbstractAstReflection,
  DefaultTokenBuilder,
  EmptyFileSystem,
  inject,
  loadGrammarFromJson,
  type GrammarAST
} from 'langium';
import type { TokenType } from 'chevrotain';
import { createDefaultModule, createDefaultSharedModule } from 'langium/lsp';
import type { CompiledGrammar } from '../compile-grammar.mjs';
import { initializeSyntax, parse } from './parser';
import { analyzeProgram } from './semantic';
import { defaults, profile, type Profile } from './profile';
import { combineLibraries, emptyLibrary, readHeader, renderEntry, type Entry } from './ontology';
import { withLibrary } from './library';
import { inspect, format, tokenTypes, type CompletionOptions } from './editor';
import { annotate, moveDeclaration, type AnnotationRequest } from './annotation';

class PublishedAstReflection extends AbstractAstReflection {
  constructor(readonly types: CompiledGrammar['types']) {
    super();
  }
}

class KeTokenBuilder extends DefaultTokenBuilder {
  protected override findLongerAlt(keyword: GrammarAST.Keyword, tokens: TokenType[]) {
    const alternatives = super.findLongerAlt(keyword, tokens);
    const identifier = tokens.find((token) => token.name === 'ID');
    // Langium handles Unicode terminal regexes as pattern functions. Its default
    // keyword check only looks for longer alternatives backed by regular expressions.
    if (
      identifier &&
      typeof identifier.PATTERN === 'function' &&
      identifier.PATTERN(keyword.value, 0, [], {})?.[0] === keyword.value &&
      !alternatives.includes(identifier)
    ) {
      alternatives.push(identifier);
    }
    return alternatives;
  }
}

export function createLanguageFromCompiled(
  artifact: CompiledGrammar & { core: string; manifest: string }
) {
  const grammar = loadGrammarFromJson(artifact.grammar);
  const shared = inject(createDefaultSharedModule(EmptyFileSystem), {
    AstReflection: () => new PublishedAstReflection(artifact.types)
  });
  const services = inject(createDefaultModule({ shared }), {
    Grammar: () => grammar,
    LanguageMetaData: () => ({
      languageId: 'ke',
      fileExtensions: ['.ke', '.keh'],
      caseInsensitive: false,
      mode: 'production' as const
    }),
    parser: { ParserConfig: () => ({}), TokenBuilder: () => new KeTokenBuilder() }
  });
  shared.ServiceRegistry.register(services);
  initializeSyntax(services);
  const coreText = artifact.core;
  const core = readHeader(coreText, 'language/core.keh');
  if (core.issues.length)
    throw new Error('core.keh: ' + core.issues.map((i) => i.message).join('\n'));
  const coreLibrary = combineLibraries(emptyLibrary(), [
    {
      source: { id: 'core', name: '内置库', uri: 'language/core.keh', enabled: true },
      header: core
    }
  ]);
  const coreError = coreLibrary.statuses.find((s) => s.state === 'error');
  if (coreError) throw new Error(coreError.message);
  function context(
    sources: { id: string; name: string; text: string }[],
    usage: Record<string, number> = {}
  ) {
    const combined = combineLibraries(
      coreLibrary.library,
      sources.map((source) => ({
        source: { ...source, uri: source.id + '.keh', enabled: true },
        header: readHeader(source.text, source.id + '.keh')
      }))
    );
    const error = combined.statuses.find((s) => s.state === 'error');
    if (error) throw new Error(`${error.name}：${error.message}`);
    const p = withLibrary(profile(), combined.library);
    for (const [name, count] of Object.entries(usage)) {
      if (p.typeMetadata[name]) p.typeMetadata[name].usage = count;
      if (p.operators[name]) {
        p.operators[name].usage = count;
        for (const s of p.operators[name].overloads || []) s.usage = count;
      }
    }
    return p;
  }
  // Cursor movement, completion, signatures and diagnostics share one analysis per text/scope.
  const analyses = new WeakMap<
    object,
    { text: string; value: ReturnType<typeof analyzeProgram> }
  >();
  function analyze(text: string, p: Profile) {
    const saved = analyses.get(p);
    if (saved?.text === text) return saved.value;
    const value = analyzeProgram(parse(text, p), p, text);
    analyses.set(p, { text, value });
    return value;
  }
  return {
    coreText,
    coreEntries: [
      ...profile().builtInTypes.map(
        (name) => ({ kind: 'concept', name, type: name, params: [] }) as Entry
      ),
      ...core.entries
    ],
    manifest: JSON.parse(artifact.manifest),
    guide: Object.fromEntries(
      Object.entries(defaults).filter(
        ([key, value]) =>
          !['variableKeyword', 'negationKeyword'].includes(key) &&
          (typeof value === 'boolean' ||
            typeof value === 'number' ||
            typeof value === 'string' ||
            ['numericTypes', 'numberTypeAliases', 'missingValues', 'outputNames'].includes(key))
      )
    ),
    context,
    readHeader,
    renderEntry,
    tokenTypes,
    editor: {
      typeSyntax: {
        set: defaults.keywords.set,
        open: defaults.surface.CallOpen[0],
        close: defaults.surface.CallClose[0]
      },
      brackets: [
        ['CallOpen', 'CallClose'],
        ['SetOpen', 'SetClose'],
        ['ProjectionOpen', 'ProjectionClose']
      ].map(([a, b]) => [defaults.surface[a][0], defaults.surface[b][0]]),
      triggers: [
        ...new Set([
          ' ',
          defaults.surface.Colon[0],
          defaults.surface.CallOpen[0],
          defaults.surface.ProjectionOpen[0],
          defaults.style.argument,
          defaults.style.condition
        ])
      ]
    },
    analyze,
    annotate(text: string, request: AnnotationRequest, p: Profile, discovery?: Profile) {
      return annotate(text, request, analyze(text, p), discovery ?? p);
    },
    moveDeclaration(
      text: string,
      selection: { start: number; end: number },
      offset: number,
      p: Profile
    ) {
      return moveDeclaration(text, selection, offset, analyze(text, p));
    },
    async inspect(text: string, offset: number, p: Profile, options: CompletionOptions = {}, discovery?: Profile) {
      const analysis = analyze(text, p);
      const result = await inspect(text, offset, analysis, p, options, discovery);
      if (!discovery) return result;
      result.completions = result.completions.filter((item) => {
        const request = item.catalogDeclaration;
        if (!request) return true;
        delete item.catalogDeclaration;
        try {
          const plan = annotate(text, request, analysis, discovery, false);
          if (request.kind === 'concept') {
            const target = plan.declaration.slice(p.keywords.concept.length + 1, -p.style.statement.length);
            item.insert = target + item.insert.slice(request.name.length);
          }
          item.edits = [
            ...(item.edits || []),
            ...plan.edits.map((edit) => edit.start <= request.position ? edit : {
              start: request.position, end: request.position, text: edit.text.trimStart()
            })
          ];
          return true;
        } catch {
          return false;
        }
      });
      return result;
    },
    format(text: string, p: Profile) {
      return format(text, analyze(text, p), p);
    }
  };
}

// Build tooling and language tests compile source. The browser uses the published artifact.
export async function createLanguage(files: Record<string, string>) {
  const { compileGrammar } = await import('../compile-grammar.mjs');
  return createLanguageFromCompiled({
    ...await compileGrammar(files['ke.langium']),
    core: files['core.keh'],
    manifest: files['manifest.json']
  });
}
