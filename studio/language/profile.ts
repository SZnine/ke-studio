import type { CallContract } from './call-contract';
import type { SymbolAliases } from './symbol-aliases';
export type SeparatorRole =
  | 'statement'
  | 'final'
  | 'condition'
  | 'argument'
  | 'setElement'
  | 'tupleElement';
export type Style = Record<SeparatorRole, string>;
export interface SymbolMetadata {
  label?: string;
  aliases?: string[];
  description?: string;
  returnDescription?: string;
  usage?: number;
  updated?: string;
}
export interface OperatorSignature extends SymbolMetadata {
  params: string[];
  returns: string;
  unit?: string;
  parameterNames?: string[];
  parameterDescriptions?: string[];
  contract?: CallContract;
  overloads?: OperatorSignature[];
  origin?: { uri: string; start: number; end: number };
}
export interface Profile {
  maxOutputs: number;
  surface: Record<string, string[]>;
  symbolAliases: SymbolAliases;
  operatorRedeclaration: boolean;
  conceptRedeclaration: boolean;
  elementAssertions: boolean;
  conceptRoot: string;
  conceptSets: boolean;
  variableKeyword: string;
  declarationOrder: boolean;
  declareBuiltIns: boolean;
  assertionValues: boolean;
  missingValues: string[];
  negationKeyword: string;
  binaryOperators: Record<string, BinaryOperator>;
  equationType: string;
  equationSymbols: boolean;
  constantNamePattern: string;
  stringLiteralType: string;
  booleanType: string;
  keywords: { concept: string; constant: string; set: string; true: string; false: string };
  operatorAliases: string[];
  builtInTypes: string[];
  typeMetadata: Record<string, SymbolMetadata & { parent?: string }>;
  compatibility: Record<string, string[]>;
  operators: Record<string, OperatorSignature>;
  pendingOperators?: Record<string, { params: string[]; returns: string }>;
  values: Record<string, SymbolMetadata & { type: string; constant?: boolean }>;
  origins: Record<string, { uri: string; start: number; end: number }>;
  style: Style;
  outputNames: string[];
  numericTypes: string[];
  numberLiteralType: string;
  numberTypeAliases: string[];
}
export const isNumericType = (type: string, p: Profile): boolean =>
  p.numericTypes.includes(type) ||
  (p.numericTypes.includes(p.numberLiteralType) && p.numberTypeAliases.includes(type));
export interface BinaryOperator {
  category: 'logic' | 'assertion' | 'ordering' | 'membership' | 'arithmetic' | 'equation';
}
export function operatorTable(p: Profile): Map<string, BinaryOperator> {
  return new Map(Object.entries(p.binaryOperators));
}
// Semantic choices belong here. Grammar spelling, separators and precedence do not.
export const scalarTypes = [
  'Number',
  'String',
  'Bool',
  'Date',
  'TimeInterval',
  'TimeDuration',
  'Any'
];
export const defaults: Profile = {
  maxOutputs: 1,
  surface: {},
  symbolAliases: { concepts: {}, operators: {} },
  builtInTypes: scalarTypes,
  typeMetadata: {},
  compatibility: {},
  operators: {},
  values: {},
  origins: {},
  outputNames: ['output'],
  keywords: { concept: '', constant: '', set: '', true: '', false: '' },
  style: {
    statement: '',
    final: '',
    condition: '',
    argument: '',
    setElement: '',
    tupleElement: ''
  },
  variableKeyword: '',
  operatorAliases: [],
  conceptRedeclaration: true,
  conceptSets: true,
  declarationOrder: true,
  declareBuiltIns: true,
  assertionValues: false,
  conceptRoot: 'Concept',
  numberLiteralType: 'Number',
  numberTypeAliases: ['Real'],
  stringLiteralType: 'String',
  booleanType: 'Bool',
  numericTypes: ['Number'],
  missingValues: ['__未定义'],
  binaryOperators: {},
  equationType: 'Expression',
  equationSymbols: true,
  constantNamePattern: '^[^A-Z]',
  negationKeyword: '',
  operatorRedeclaration: true,
  elementAssertions: true
};
export function profile(overrides: Partial<Profile> = {}, base: Profile = defaults): Profile {
  return {
    ...structuredClone(base),
    ...overrides,
    keywords: { ...base.keywords, ...overrides.keywords },
    style: { ...base.style, ...overrides.style },
    compatibility: { ...base.compatibility, ...overrides.compatibility },
    operators: { ...base.operators, ...overrides.operators },
    symbolAliases: {
      concepts: { ...base.symbolAliases.concepts, ...overrides.symbolAliases?.concepts },
      operators: { ...base.symbolAliases.operators, ...overrides.symbolAliases?.operators }
    },
    typeMetadata: { ...base.typeMetadata, ...overrides.typeMetadata },
    values: { ...base.values, ...overrides.values },
    origins: { ...base.origins, ...overrides.origins }
  };
}
