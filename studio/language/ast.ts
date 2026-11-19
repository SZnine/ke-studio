export interface Span {
  start: number;
  end: number;
}
export interface Token extends Span {
  kind: 'id' | 'number' | 'string' | 'punct' | 'comment' | 'eof';
  text: string;
}
export interface Issue extends Span {
  code: string;
  message: string;
  fix?: { name: string; type: string };
  replacement?: string;
}
export interface TypeRef extends Span {
  name: string;
  element?: TypeRef;
  elements?: TypeRef[];
}
export type Expr = Span & { grouped?: boolean } & (
    | { kind: 'id'; name: string }
    | { kind: 'literal'; value: string; type: string }
    | { kind: 'call'; name: string; nameSpan: Span; args: Expr[]; projection?: boolean }
    | { kind: 'binary'; op: string; left: Expr; right: Expr }
    | { kind: 'unary'; op: string; value: Expr }
    | { kind: 'set' | 'tuple'; elements: Expr[] }
    | { kind: 'comprehension'; output: Expr; condition: Expr }
    | { kind: 'clauses'; bindings: Binding[]; conditions: Expr[] }
    | { kind: 'rule'; conclusion: Expr; body: Expr }
  );
export interface Binding extends Span {
  name: string;
  nameSpan: Span;
  type?: TypeRef;
  domain?: Expr;
  constant?: boolean;
}
export interface Declaration extends Span {
  kind: 'concept' | 'operator' | 'object' | 'constant';
  name: string;
  nameSpan: Span;
  type?: TypeRef;
  params: TypeRef[];
  parameterNames?: string[];
  parent?: TypeRef;
  parentForm?: 'set';
  initializer?: Expr;
}
export interface Statement extends Span {
  kind: 'expression';
  expression: Expr;
}
export interface Program {
  statements: (Declaration | Statement)[];
  tokens: Token[];
  issues: Issue[];
  delimiters: (Span & { role: import('./profile').SeparatorRole })[];
}
