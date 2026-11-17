// Stable third-party bridge. Editable language modules import this file;
// the web app does not import a parser or carry another language definition.
export {
  createServicesForGrammar,
  createLangiumGrammarServices,
} from "langium/grammar";
export {
  EmptyFileSystem,
  URI,
  AstUtils,
  CstUtils,
  GrammarUtils,
} from "langium";
export { pinyin, match } from "pinyin-pro";
