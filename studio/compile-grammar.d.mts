import type { AstMetaData } from "langium";

export interface CompiledGrammar {
  grammar: string;
  types: AstMetaData;
}

export function compileGrammar(source: string): Promise<CompiledGrammar>;
