# KE Studio

[打开网页](https://sznine.github.io/ke-studio/) · [下载本地版](https://github.com/SZnine/ke-studio/releases/tag/local) · [二次开发](CONTRIBUTING.md)

在浏览器中编写 KE，管理领域 CO 和题库，并通过模型对话修改题目、审核 CO 与语法建议。

## 开始

使用桌面版 Edge 或 Chrome 打开网页，先选择一个本地保存文件夹。首次打开会复制初始领域、CO 和语言文件；之后重新打开同一文件夹即可继续。GitHub 只发布程序和初始模板，网页更新不会替换已有工作区。

- 顶部选择或新建题库；各题库的题目、草稿、对话和标准例独立保存。
- 拖动领域可以排序，放在领域中间成为子领域，放在上下边缘调整同级顺序。右键或 `⋯` 可新增子领域、重命名、移动和删除。
- 子领域使用自身、所有父级及通用库的 CO；同名定义以较近的领域为准。删除领域及子领域时，关联文件先移到回收区，可从修改历史恢复。
- 草稿默认检索全领域 CO，也可选择一个领域及其父级。全领域同名词条以当前领域及父级优先，其他领域按字典顺序解析；有同名差异时选择具体领域。草稿可手动存入指定领域的题库。
- 题目支持 KE/JSON 导入导出、补全、语法高亮、签名提示、格式化和检查。自动补全优先当前书写上下文；Ctrl+Space 展开当前位置的可用候选，中文、拼音和缩写也可检索。
- 在模型设置中配置兼容 Chat Completions 的接口及模型。密钥只存于当前浏览器，不进入工作区或发布文件。接口需要允许浏览器跨域访问；DeepSeek 已检查其 CORS 支持。模型对话按需发送当前题目、语言或 CO 内容到你配置的接口。
- 模型的 CO/语言修改先生成待审建议，由用户决定采纳；已确认标准例在共享资源变更时跨题库校验。思考和工具过程可折叠，正文使用 Markdown 流式渲染。

## 本地文件

```text
ke-workspace.json       工作区与题库索引
shared/
  domains.json         领域树
  libraries/*.keh      按领域保存的 CO
  language/*           可执行 EBNF、语义和编辑器策略
banks/<题库>/
  questions/<领域>/    每题一个 JSON
  drafts/<领域>/       独立草稿
  chats/               对话
  coke/                人工标准例
  proposals/           尚未处理的建议
  history.jsonl        修改记录
settings/model.json    接口与模型名称，不含密钥
trash/                 已删除领域及其文件
```

备份或迁移时复制整个保存文件夹即可。切换浏览器后重新选择文件夹并设置模型密钥。建议在一个标签页中编辑同一工作区。

## 语法和模板维护

文法入口是 `studio/language/ke.langium`，语义位于同目录下的 `profile.ts`、`semantic.ts`；`core.keh` 定义内置 CO，`editor.ts` 管理补全策略。浏览器用 Langium 和 esbuild WASM 直接编译工作区里的语言文件。下游补全、高亮、签名和检查消费同一实例，界面不另存语法表。

普通用户在网页的“语言”页编辑并应用，或直接编辑保存文件夹中的 `shared/language`。发布者更新初始模板时运行：

```powershell
npm run template -- "本地工作区文件夹"
```

脚本只读取共享领域、CO 和语言，不复制题目、对话、日志或模型配置。检查修改后提交到 `main`，GitHub Actions 会构建并更新网页。

## 本地运行与二次开发

下载本地包后安装 Node.js 22 或更新版本，解压并双击 `start.cmd`。默认打开 `http://127.0.0.1:4340/ke-studio/`，无需安装 npm 依赖。详见[本地运行说明](docs/local.md)。

二次开发直接克隆本仓库：

```sh
git clone https://github.com/SZnine/ke-studio.git
cd ke-studio
npm ci
npm run dev
```

开发地址为 `http://127.0.0.1:4331/ke-studio/`。源码修改后自动构建，刷新页面即可查看；`npm start` 启动日常使用的本地版。源码入口与语法更新流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

```sh
npm run check
npm test
npm run package:local
npm run test:local
```

构建输出为 `dist/` 和 `release/ke-studio-local.zip`。推送 `main` 会更新网页与同一个本地发行包。应用数据留在用户选择的文件夹中。

`node scripts/browser-check.mjs` 生成仅用于本地验证的 `check.html`，通过浏览器沙箱文件系统检查真实 Worker、WASM 编译、题库隔离、继承、草稿范围和删除恢复。下一次正式构建会清除该页面。

界面使用既有的浅色/深色主题和 Google Sans Code。第三方许可随静态构建附在 `THIRD-PARTY-NOTICES.txt`。
