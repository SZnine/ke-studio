import { completionSearchRank } from "../completion-search";
import { digest } from "./engine";
import { ChatEvent, ChatContext, entryKey } from "./language";
import { Change, Store } from "./store";
import { questionSummary } from "./questions";

export { patchSources } from "./source-edits";

const string = { type: "string" };
const domain = {
  ...string,
  description: "领域 ID，省略则为当前领域；common 为通用库。",
};
const revision = {
  ...string,
  description: "读取工具返回的 revision，防止覆盖刚发生的编辑。",
};
const appendProposal = {
  ...string,
  description:
    "长任务追加到同一待审组的 ID。只传本批新增或修正项，自动与先前批次联合校验；不重复发送整组。",
};
const entry = {
  type: "object",
  properties: {
    kind: { enum: ["concept", "operator", "constant", "object"] },
    name: string,
    type: {
      ...string,
      description: "类型；集合使用内部表示 set{Type}，概念填写自身名称。",
    },
    parent: string,
    parentForm: { enum: ["set"] },
    label: string,
    aliases: { type: "array", items: string },
    description: string,
    params: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: string,
          type: string,
          description: string,
        },
        required: ["name", "type"],
      },
    },
    returnDescription: string,
    unit: string,
    contract: { type: "object" },
    usage: { type: "integer", description: "保留原引用次数，不由模型估算。" },
  },
  required: ["kind", "name", "type", "params"],
};
function tool(
  name: string,
  description: string,
  properties: object,
  required: string[] = [],
) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required },
    },
  };
}
const tools = [
  tool(
    "read_coke",
    "读取人工标准例及其检查结果。confirmed=true 的例子是修改依据，模型不能确认、删除或改写标准例来绕过回归。",
    { domain },
  ),
  tool(
    "read_language",
    "读取当前可编辑的语言文件。默认读取文法、语义说明和内置库；修改前请读取相关源文件。",
    {
      files: { type: "array", items: string },
    },
  ),
  tool(
    "update_language",
    "提出语言文件修改建议，编译及检查通过后进入待审，用户勾选采纳才生效。",
    {
      revision,
      replaceProposal: string,
      appendProposal,
      reason: string,
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            file: string,
            reason: string,
            recommended: { type: "boolean" },
            before: { ...string, description: "文件中精确且唯一的原文片段。" },
            after: string,
          },
          required: ["file", "before", "after"],
        },
      },
    },
    ["revision", "reason", "edits"],
  ),
  tool(
    "read_library",
    "查询 CO 名称、中文、拼音和说明。默认读取内置、通用和当前领域库；可用 domain 指定领域。返回每个库的 revision 和完整条目，按 offset 分页。",
    {
      domain,
      query: string,
      kind: { enum: ["concept", "operator", "constant", "object"] },
      offset: { type: "integer", minimum: 0 },
    },
  ),
  tool(
    "update_library",
    "提出新增、修改或删除 CO 的待审建议，绝不直接改库。每项 reason 简述依据或冲突，recommended=false 表示优化后的可选方案；修改前读取原条目，entry 是完整新条目，保留未要求变更的字段；删除用 entry:null，新建不填 key。同批提交有依赖的概念和算子。",
    {
      domain,
      revision,
      replaceProposal: string,
      appendProposal,
      reason: string,
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: string,
            reason: string,
            recommended: { type: "boolean" },
            entry: { anyOf: [entry, { type: "null" }] },
          },
          required: ["entry"],
        },
      },
    },
    ["revision", "reason", "edits"],
  ),
  tool(
    "create_domain",
    "用户需要新增领域时创建一个空领域库，返回领域 ID。",
    { name: string },
    ["name"],
  ),
  tool(
    "list_questions",
    "按题号或题干查当前领域题库；返回题号与 ID，未指定题号时先定位，不猜测题目。",
    { query: string, offset: { type: "integer" } },
  ),
  tool(
    "read_question",
    "读取指定题号或 ID 的原文、KE、备注及检查结果；省略 question 时读当前选中的题。",
    { question: string },
  ),
  tool(
    "update_question",
    "修改刚读取的题目。id 和 revision 必须来自 read_question；只提交要修改的 prompt、ke 或 notes，检查通过后保存并记录。",
    {
      id: string,
      revision,
      prompt: string,
      ke: string,
      notes: string,
      reason: string,
    },
    ["id", "revision", "reason"],
  ),
  tool(
    "create_question",
    "用户要求新增题目时创建一条记录；题号在本领域唯一，留空自动生成。",
    { number: string, prompt: string, ke: string },
    ["prompt"],
  ),
  tool(
    "read_history",
    "读取最近修改的摘要，指定 id 时读取该次修改的完整前后内容。",
    {
      id: string,
    },
  ),
  tool(
    "restore_change",
    "用户要求撤销时，将指定记录对应的文件恢复到该次修改前；这也会生成新的历史记录。",
    { id: string },
    ["id"],
  ),
];
const parametersOf = (name: string) =>
  tools.find((t) => t.function.name === name)!.function.parameters;
tools.push(
  tool(
    "read_proposal",
    "读取待审建议。长任务用 appendProposal 追加或修正部分条目；完整重做才用 replaceProposal。",
    { id: string },
    ["id"],
  ),
  tool(
    "read_draft",
    "读取当前草稿，或用 question 指定草稿 ID；草稿不是正式题目。",
    {
      question: string,
    },
  ),
  tool(
    "update_draft",
    "按读取版本修改草稿，保留草稿状态，不自动存入题库。",
    parametersOf("update_question").properties,
    ["id", "revision", "reason"],
  ),
  tool(
    "apply_update",
    "提出一组语言与 CO 的待审替换建议：先编译、检查所有库和人工标准例，用户选择后才覆盖。删除或替换旧 CO 用 edits，不保留旧别名凑兼容。",
    {
      reason: string,
      replaceProposal: string,
      appendProposal,
      language: {
        ...parametersOf("update_language"),
        required: ["revision", "edits"],
      },
      libraries: {
        type: "array",
        items: {
          ...parametersOf("update_library"),
          required: ["revision", "edits"],
        },
      },
    },
    ["reason"],
  ),
);

export class AssistantTools {
  readonly definitions = tools;
  constructor(private store: Store) {}
  async execute(
    domain: string,
    name: string,
    args: any,
    changes: Change[],
    emit: (event: ChatEvent) => void,
    signal: AbortSignal,
    context: ChatContext = {},
  ) {
    const status: Record<string, string> = {
      read_coke: "正在读取人工标准例…",
      read_proposal: "正在读取待审建议…",
      read_draft: "正在读取草稿…",
      update_draft: "正在更新草稿…",
      apply_update: "正在校验更新建议…",
      read_language: "正在读取语言定义…",
      update_language: "正在生成语言建议…",
      read_library: "正在查找 CO…",
      update_library: "正在生成 CO 建议…",
      create_domain: "正在创建领域…",
      list_questions: "正在查找题号…",
      read_question: "正在读取题目…",
      update_question: "正在检查并保存题目…",
      create_question: "正在新增题目…",
      read_history: "正在读取修改历史…",
      restore_change: "正在恢复修改…",
    };
    if (!Object.hasOwn(status, name)) throw new Error(`未知工具：${name}`);
    if (
      context.intent &&
      [
        "update_question",
        "update_draft",
        "create_question",
        "create_domain",
        "restore_change",
      ].includes(name)
    )
      throw new Error("此入口只分析并生成待审建议，不直接改动题目或库。");
    emit({ type: "status", text: status[name] });
    return this.store.mutate(async () => {
      signal.throwIfAborted();
      const store = this.store;
      await store.engine.refresh();
      const files = await store.engine.sources();
      const saved = (items: (Change | undefined)[]) => {
        const actual = items.filter((c): c is Change => !!c);
        changes.push(...actual);
        return {
          saved: actual.map(({ id, file, reason }) => ({ id, file, reason })),
        };
      };
      switch (name) {
        case "read_coke": {
          const selected = args.domain || domain;
          const ids = selected === "common" ? ["common"] : ["common", selected];
          return Promise.all(
            ids.map(async (id) => ({
              domain: id,
              cases: await store.coke(id),
              checks: (await store.checkCoke()).filter((r) => r.domain === id),
            })),
          );
        }
        case "apply_update":
          return store.reviews.propose(domain, args);
        case "read_language": {
          const names: string[] = args.files || [
            "README.md",
            "ke.langium",
            "core.keh",
          ];
          for (const file of names)
            if (!(file in files)) throw new Error(`未知语言文件：${file}`);
          return {
            revision: digest(files),
            files: Object.fromEntries(names.map((file) => [file, files[file]])),
          };
        }
        case "update_language":
          return store.reviews.propose(domain, {
            reason: args.reason,
            replaceProposal: args.replaceProposal,
            appendProposal: args.appendProposal,
            language: args,
          });
        case "read_library": {
          const state = await store.workspace(
              args.domain === "core" ? domain : args.domain || domain,
              args.domain ? undefined : context.draftId || context.questionId,
              !args.domain && !!context.draftId,
            ),
            service = store.engine.service;
          const core = { id: "core", name: "内置库", text: service.coreText };
          const sources =
            args.domain === "core"
              ? [core]
              : args.domain
                ? state.libraries.filter((lib) => lib.id === args.domain)
                : [core, ...state.libraries];
          const offset = Math.max(0, Number(args.offset) || 0);
          return sources.map((lib) => {
            const entries = service
              .readHeader(lib.text, lib.id)
              .entries.filter((e) => !args.kind || e.kind === args.kind)
              .map((e) => ({
                entry: e,
                rank: completionSearchRank(
                  args.query || "",
                  e.name,
                  [e.label || "", ...(e.aliases || [])],
                  [e.description || ""],
                ),
              }))
              .filter((e) => e.rank >= 0)
              .sort((a, b) => a.rank - b.rank)
              .map((e) => e.entry);
            return {
              id: lib.id,
              name: lib.name,
              revision: digest({ text: lib.text }),
              total: entries.length,
              nextOffset: offset + 60 < entries.length ? offset + 60 : null,
              entries: entries
                .slice(offset, offset + 60)
                .map(({ span, key, ...entry }) => ({
                  ...entry,
                  key: entryKey(entry),
                })),
            };
          });
        }
        case "update_library":
          return store.reviews.propose(domain, {
            reason: args.reason,
            replaceProposal: args.replaceProposal,
            appendProposal: args.appendProposal,
            libraries: [args],
          });
        case "read_proposal":
          return (
            (await store.reviews.list(domain)).find(
              (p) => p.id === args.id,
            ) || {
              error: "建议已处理。",
            }
          );
        case "create_domain": {
          const created = await store.addDomain(args.name);
          const change = (await store.history()).at(-1);
          return { domain: created, ...saved([change]) };
        }
        case "list_questions": {
          const query = String(args.query || "").toLowerCase();
          const items = (await store.questions.list(domain)).filter(
            (q) =>
              q.number.toLowerCase().includes(query) ||
              q.prompt.toLowerCase().includes(query),
          );
          const offset = Math.max(0, Number(args.offset) || 0);
          return {
            total: items.length,
            nextOffset: offset + 40 < items.length ? offset + 40 : null,
            questions: items
              .slice(offset, offset + 40)
              .map((q) => ({
                ...questionSummary(q),
                prompt: q.prompt.slice(0, 240),
              })),
          };
        }
        case "read_question":
        case "read_draft": {
          const isDraft = name === "read_draft";
          const question = await (isDraft ? store.drafts : store.questions).get(
            domain,
            args.question ||
              (isDraft ? context.draftId : context.questionId) ||
              "",
          );
          const state = await store.workspace(
              domain,
              context.draftId || context.questionId,
              !!context.draftId,
            ),
            service = store.engine.service;
          const { issues } = await service.inspect(
            question.ke,
            0,
            store.context(state.libraries),
            { enabled: false },
          );
          return {
            question,
            revision: digest({ question: JSON.stringify(question) }),
            issues,
          };
        }
        case "update_question":
        case "update_draft": {
          const isDraft = name === "update_draft";
          const question = await (isDraft ? store.drafts : store.questions).get(
            domain,
            args.id,
          );
          const state = await store.workspace(
              domain,
              context.draftId || context.questionId,
              !!context.draftId,
            ),
            service = store.engine.service;
          if (args.revision !== digest({ question: JSON.stringify(question) }))
            throw new Error("题目已更新，请重新读取后再改。");
          const next = {
            ...question,
            ...Object.fromEntries(
              ["prompt", "ke", "notes"]
                .filter((key) => typeof args[key] === "string")
                .map((key) => [key, args[key]]),
            ),
          };
          const { issues } = await service.inspect(
            next.ke,
            0,
            store.context(state.libraries),
            {
              enabled: false,
            },
          );
          if (issues.some((i) => i.severity !== "warning"))
            return { saved: [], issues };
          const result = await store.saveQuestion(
            domain,
            next,
            false,
            `模型：${args.reason}`,
            isDraft,
          );
          return {
            ...saved([result.change]),
            question: questionSummary(result.question),
            issues,
          };
        }
        case "create_question": {
          const result = await store.saveQuestion(
            domain,
            { number: args.number, prompt: args.prompt, ke: args.ke || "" },
            true,
            "模型新增题目",
          );
          return {
            ...saved([result.change]),
            question: questionSummary(result.question),
          };
        }
        case "read_history": {
          const history = await store.history();
          if (args.id)
            return (
              history.find((c) => c.id === args.id) || { error: "记录不存在。" }
            );
          return history
            .slice(-20)
            .reverse()
            .map(({ id, file, reason, time }) => ({ id, file, reason, time }));
        }
        case "restore_change":
          return saved(await store.restore(args.id));
      }
    });
  }
}
