# 语言包

日常增加 CO 使用 `.keh`。这里维护长期演进的语言定义。

- `ke.langium`：真正参与解析器构建的 EBNF；每种分隔符的第一个备选是规范写法，其余备选用于定位旧标点并提供修复。
- `parser.ts`：Langium AST 到语义模型的映射。只处理结构、跨度和声明/成员关系的上下文消歧，不含领域算子名单。
- `profile.ts`：类型与语义政策，例如 Real 数值兼容、Concept 公共父类型、最多一个 output。拼写和分隔符在加载时从文法提取。
- `semantic.ts`：名称、作用域、继承、重载、表达式类型和调用约束。
- `core.keh`：内置 CO。`@contract` 表达高阶算子的参数/返回关系，普通算子只需签名和说明。
- `ontology.ts`、`library.ts`：声明元数据、库组合和当前文法下的声明渲染。
- `editor.ts`：消费解析、符号和文法位置，提供补全、签名、悬停、着色与格式化。
- `completion-edits.ts`：从当前作用域和 CO 签名提供待绑定变量，处理继续书写条件时的分隔符。
- `annotation.ts`：原文划选到概念、算子声明的编辑计划，复用当前 CO、父类型、签名和文法；声明拖放只选择合法边界并保留依赖顺序。
- `pending-co.ts`：不完整算子以 `// @draft {…}` 元数据保存在所属领域 `.keh`；空字段原样保留，暂不进入可执行符号表。补齐签名时替换为正式声明。
- `diagnostics.ts`：简短的可操作检查信息，保留原始详情及明确的逐处修复。
- `ast.ts`、`types.ts`、`call-contract.ts`、`symbol-aliases.ts`、`completion-search.ts`：共享数据和小型辅助函数。
- `index.ts`：稳定的语言服务入口；`manifest.json` 标识人的语言版本，程序另用内容摘要识别实际改动。

修改后在网页点击“编译并应用”；直接用外部编辑器保存时，网页轮询时自动读取并编译。无需手工执行生成命令，也无需重启网页。编译失败会显示错误，当前会话继续使用上一个可用实例。

声明名称补全读取库中的全局符号：概念位置只列概念，算子位置带出固定签名；新常量和局部绑定名称由用户命名。表达式候选再按作用域、参数类型和检索词筛选。关键字和分隔符从文法获取，空格触发补全；不在客户端保留另一张语法候选表。

语句开头优先关键字，同等检索匹配下领域库优先于内置定义；概念声明不重复提示文件中已声明的概念。名称、中文名、别名和拼音有匹配时不扩展到备注，备注只作为无名称匹配时的回退。完整声明补齐当前 `StatementSeparator` 并换行；已有结束符会复用，声明仍有后续结构时不提前结束。智能模式的绑定类型补全使用 `ConditionSeparator` 并换行，保留外层 set 括号。排序、匹配与结束符插入都由语言包维护，客户端消费结果。

新的模块必须在本目录并由 `index.ts` 间接或直接导入。第三方组件通过 `../framework.mjs` 桥接；应用主程序不参与每次语言修改。

默认语义保持：语句以 `;` 结束；参数、条件、集合、元组用 `,`；大写 `EQ` 构造 Expression，两侧未声明的名称是仅在该方程内有效的数学符号；`=` 作断言。已声明的对象仍按类型检查，方程外的漏声明仍报错。`profile.ts` 中 `equationSymbols` 控制此规则。裸 `x:set(T)` 是集合值声明，显式 concept 或 `<:` 表达子类型；语句级 `名字 : 类型`（名字此前未声明）按常量声明处理，可写 `名字 : 类型 = 初值`，不需要 `const`。整数、小数、负数和科学计数法与内置 Real 兼容；算术与数值检查按声明层次判断，Number 的声明子类型同样算数值。一个文件最多一个顶层 output。

文件中同名概念可重申库定义；显式写出父类时，以该文件的声明为准，不改变全局库。不写父类则继承库的关系；同一文件重复声明、未知父类和循环继承仍报错。内置标量（Number、Bool、String 等）没有库来源，自身只允许不带父类的裸重申，带父类仍报错；其它概念可以把内置概念写成父类，例如 `concept Real <: Number;`，此时按本文档的声明检查。等价的 Number/Real 参数和返回类型可重申。循环继承只按声明的父类判断，兼容别名不算继承边。库之间允许重复导入相同父类的概念，冲突定义仍拒绝加载。

`@contract {"overloads":"closed"}` 表示算子签名由库限定，文档不能添加其它重载。内置 min/max 使用此规则，避免 `op min(Number): Number` 让错误调用绕过集合检查；新增合法签名应直接编辑声明库。等价返回类型的重申不受限，例如 `op min(items: set(Real)) : Real` 与 `set(Number) : Number` 互为别名，会替换该签名而不是新增。`constantNamePattern` 是 const 名称的风格检查，默认要求首字母小写，只提示警告；空字符串关闭。规则没有按数学领域或具体算子名称写入通用检查器。

人工标准例在独立的 `banks/<题库>/coke/<领域>.json` 中维护。语言或 CO 更新前，已确认例子的语法和类型必须通过；业务含义仍以人工确认的原文和备注为准。

自动补全以当前书写意图为准：语句开头优先 concept/op/const/output，concept/op 后只给对应类别；表达式隐藏裸概念和未使用的通用算子，结合局部变量、声明与参数或断言左侧类型筛选。算术符号后不自动弹出空前缀列表。输入名称、中文或拼音仍可检索全库；Ctrl+Space 显式请求时展开当前位置允许的候选。此策略在 editor.ts 中维护。

“智能”模式用 CO 的输入输出类型补齐声明，调用用 Tab 参数占位和签名提示；已有括号不重复插入。类型位置（包括成员绑定中的嵌套 set）仅提供类型与类型构造器。条件分隔符后的空位置优先提供尚未绑定的输出变量，能从 CO 参数推断出唯一类型时预填，不能确定则留空；不臆测数学数值。继续条件按 Enter 时，仅在前一条完整且未带分隔符时插入文法规定的 ConditionSeparator。手动展开仍保留合法的其他选择。

实现参考 [VS Code 参数占位](https://code.visualstudio.com/docs/editing/userdefinedsnippets)、[TypeScript Language Server 调用补全](https://github.com/typescript-language-server/typescript-language-server/blob/master/src/completion.ts) 和 [Langium 作用域解析](https://langium.org/docs/learn/workflow/resolve_cross_references/)。候选、分隔符和补全编辑均由本语言包产生，Monaco 只负责展示和应用；调整 CO 签名或文法后无需改界面代码。

原文工具参考 [Label Studio 的文本片段标注](https://labelstud.io/guide/labeling)，使用 [Monaco decorations 和编辑操作](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IStandaloneCodeEditor.html) 跟踪位置、显示高亮和悬停说明。原文保持纯文本，关联信息随题目 JSON 保存；修改片段内容导致证据不再匹配时解除该高亮，不删除用户代码。

`declareBuiltIns` 默认开启：代码显式引用内置概念或算子时，必须有本文件声明；库仍提供检索、签名及类型依据。数值和字符串字面量的隐式类型不要求额外声明。C/O 声明生成会补齐内置参数类型；严格检查只作用于 KE，`.keh` 的签名不受此限制。

库中定义与文档声明分开处理：文档首次声明等价签名合法，本文件再次声明同一签名才是重复声明。返回类型与库不一致单独提示差异。检查、C/O 声明复用及声明补全共用 `types.ts` 的类型等价判断；`Number` 与 `Real` 等兼容别名不会造成重复插入。声明是否必需由 `declareBuiltIns` 控制，定义来自库不会阻止本文首次声明。
