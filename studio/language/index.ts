import {
  createServicesForGrammar,
  createLangiumGrammarServices,
  EmptyFileSystem,
  URI
} from '../framework.mjs';
import { initializeSyntax, parse } from './parser';
import { analyzeProgram } from './semantic';
import { defaults, profile } from './profile';
import { combineLibraries, emptyLibrary, readHeader, renderEntry, type Entry } from './ontology';
import { withLibrary } from './library';
import { inspect, format, tokenTypes } from './editor';
import { annotate, moveDeclaration, type AnnotationRequest } from './annotation';

export async function createLanguage(files: Record<string, string>, previousCore?: any[]) {
  const grammarServices = createLangiumGrammarServices(EmptyFileSystem).grammar;
  const doc = grammarServices.shared.workspace.LangiumDocumentFactory.fromString<any>(
    files['ke.langium'],
    URI.parse('memory:/ke.langium')
  );
  await grammarServices.shared.workspace.DocumentBuilder.build([doc], { validation: true });
  const errors = doc.diagnostics?.filter((d: any) => d.severity === 1) || [];
  if (errors.length)
    throw new Error(
      errors.map((d: any) => `ke.langium:${d.range.start.line + 1} ${d.message}`).join('\n')
    );
  const services = await createServicesForGrammar({
    grammar: doc.parseResult.value,
    grammarServices,
    languageMetaData: {
      languageId: 'ke',
      fileExtensions: ['.ke', '.keh'],
      caseInsensitive: false,
      mode: 'development'
    }
  });
  // Force parser construction now, not on the first user keystroke.
  const definitions = services.parser.LangiumParser.definitionErrors;
  if (definitions.length) throw new Error(definitions.map((e: any) => e.message).join('\n'));
  initializeSyntax(services);
  let coreText = files['core.keh'];
  if (previousCore)
    for (const entry of [...previousCore].reverse())
      coreText =
        coreText.slice(0, entry.span.start) + renderEntry(entry) + coreText.slice(entry.span.end);
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
  function analyze(text: string, p: any) {
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
    manifest: JSON.parse(files['manifest.json']),
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
    annotate(text: string, request: AnnotationRequest, p: any) {
      return annotate(text, request, analyze(text, p), p);
    },
    moveDeclaration(
      text: string,
      selection: { start: number; end: number },
      offset: number,
      p: any
    ) {
      return moveDeclaration(text, selection, offset, analyze(text, p));
    },
    inspect(text: string, offset: number, p: any, options: any = {}) {
      return inspect(text, offset, analyze(text, p), p, options);
    },
    format(text: string, p: any) {
      return format(text, analyze(text, p), p);
    }
  };
}
