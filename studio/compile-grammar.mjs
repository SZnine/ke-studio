import { EmptyFileSystem, URI } from "langium";
import {
  createLangiumGrammarServices,
  createServicesForGrammar,
} from "langium/grammar";

export async function compileGrammar(source) {
  const grammarServices = createLangiumGrammarServices(EmptyFileSystem).grammar;
  const document = grammarServices.shared.workspace.LangiumDocumentFactory.fromString(
    source,
    URI.parse("memory:/ke.langium"),
  );
  await grammarServices.shared.workspace.DocumentBuilder.build([document], {
    validation: true,
  });
  const errors = document.diagnostics?.filter(({ severity }) => severity === 1);
  if (errors?.length)
    throw new Error(
      errors.map(({ range, message }) =>
        `ke.langium:${range.start.line + 1} ${message}`,
      ).join("\n"),
    );
  const grammar = document.parseResult.value;
  const services = await createServicesForGrammar({ grammar, grammarServices });
  // Initializing the development parser catches grammar-definition errors at build time.
  const definitions = services.parser.LangiumParser.definitionErrors;
  if (definitions.length)
    throw new Error(definitions.map(({ message }) => message).join("\n"));
  return {
    grammar: grammarServices.serializer.JsonSerializer.serialize(grammar),
    types: services.shared.AstReflection.types,
  };
}
