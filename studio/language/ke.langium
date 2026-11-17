grammar KE

// The first alternative of each separator is canonical. Other alternatives
// are parsed only to offer a precise, local punctuation fix.
entry Program: (statements+=Statement StatementSeparator)*;
Statement: ConceptDeclaration | OperatorDeclaration | ConstantDeclaration | ExpressionStatement;
ConceptDeclaration: ConceptKeyword name=ID (Subtype parent=Type | Colon setParent=Type)?;
OperatorDeclaration: OperatorKeyword name=ID CallOpen
    (parameters+=Parameter (ArgumentSeparator parameters+=Parameter)*)?
    CallClose Colon type=Type;
Parameter: (name=ID Colon)? type=Type;
ConstantDeclaration: ConstantKeyword name=ID Colon type=Type (Assign initializer=Expression)?;
ExpressionStatement: expression=Expression;
Type: SetType | NamedType;
SetType: SetKeyword CallOpen element=Type CallClose;
NamedType: name=(ID | 'operator');

// Tree rewriting makes precedence explicit. EQ constructs an expression;
// comparison and assertion operators are outside it.
Expression: Rule;
Rule: Membership ({infer RuleExpression.conclusion=current} RuleArrow body=RuleClauses)?;
Membership: Or ({infer Binary.left=current} op=(Colon | Subtype) right=Or)?;
Or: And ({infer Binary.left=current} op=OrOperator right=And)*;
And: Negation ({infer Binary.left=current} op=AndOperator right=Negation)*;
Negation: NegationExpression | Comparison;
NegationExpression: op=NegationOperator value=Negation;
Comparison: Equation ({infer Binary.left=current} op=ComparisonOperator right=Equation)?;
Equation: Addition ({infer Binary.left=current} op=EquationOperator right=Addition)?;
Addition: Multiplication ({infer Binary.left=current} op=AddOperator right=Multiplication)*;
Multiplication: Unary ({infer Binary.left=current} op=MultiplyOperator right=Unary)*;
Unary: UnaryExpression | Power;
UnaryExpression: op=UnaryOperator value=Unary;
Power: Primary ({infer Binary.left=current} op=PowerOperator right=Unary)?;
Primary: NumberLiteral | StringLiteral | BooleanLiteral | NamedExpression | Group | SetExpression;
NumberLiteral: value=NUMBER;
StringLiteral: value=STRING;
BooleanLiteral: value=BooleanKeyword;
NamedExpression: name=(ID | SetKeyword)
    (CallOpen (args+=Expression (ArgumentSeparator args+=Expression)*)? CallClose
    | projection?=ProjectionOpen (args+=Expression (ArgumentSeparator args+=Expression)*)? ProjectionClose)?;
Group: GroupOpen elements+=Expression (TupleSeparator elements+=Expression)* GroupClose;
SetExpression: SetOpen
    (elements+=Expression (SetSeparator elements+=Expression)* (Filter clauses=Clauses)?)?
    SetClose;
Clauses: items+=Clause (ConditionSeparator items+=Clause)*;
// An unbraced rule body cannot consume the surrounding statement terminator.
RuleClauses: items+=Clause (RuleSeparator items+=Clause)*;
Clause: LocalBinding | Membership;
LocalBinding: keyword=(VariableKeyword | ConstantKeyword) name=ID Colon domain=Or;

ConceptKeyword returns string: 'concept';
OperatorKeyword returns string: 'op' | 'operator';
ConstantKeyword returns string: 'const';
VariableKeyword returns string: 'var';
SetKeyword returns string: 'set';
BooleanKeyword returns string: 'true' | 'false';
OrOperator returns string: 'OR';
AndOperator returns string: 'AND';
ComparisonOperator returns string: AssertionOperator | OrderingOperator;
AssertionOperator returns string: Assign | '!=';
OrderingOperator returns string: '<' | '>' | '<=' | '>=';
EquationOperator returns string: 'EQ';
AddOperator returns string: '+' | '-';
MultiplyOperator returns string: '*' | '/' | '%';
PowerOperator returns string: '^';
NegationOperator returns string: 'NOT';
UnaryOperator returns string: '+' | '-';
Colon returns string: ':';
Subtype returns string: '<:';
Assign returns string: '=';
RuleArrow returns string: ':-';
Filter returns string: '|';
CallOpen returns string: '(';
CallClose returns string: ')';
ProjectionOpen returns string: '[';
ProjectionClose returns string: ']';
GroupOpen returns string: '(';
GroupClose returns string: ')';
SetOpen returns string: '{';
SetClose returns string: '}';
StatementSeparator returns string: ';' | ',' | '；' | '，';
ArgumentSeparator returns string: ',' | ';' | '，' | '；';
ConditionSeparator returns string: ',' | ';' | '，' | '；';
RuleSeparator returns string: ',' | '，';
SetSeparator returns string: ',' | ';' | '，' | '；';
TupleSeparator returns string: ',' | ';' | '，' | '；';

terminal NUMBER: /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
terminal STRING: /"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'/;
terminal ID: /[_\p{L}][_\p{L}\p{N}]*/u;
hidden terminal COMMENT: /\/\/[^\r\n]*|--[^\r\n]*/;
hidden terminal WS: /\s+/;
