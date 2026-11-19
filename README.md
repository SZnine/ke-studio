# KE Studio

[打开网页](https://sznine.github.io/ke-studio/) · [下载本地版](https://github.com/SZnine/ke-studio/releases/tag/local) · [二次开发](CONTRIBUTING.md)

KE Studio 是本地题库、KE 编辑和 CO 检索工作台。用桌面版 Edge 或 Chrome 打开，选择一个本地保存文件夹即可开始。首次使用会准备数学题库的 103 道题，已有工作区直接打开原题库。

## 题目与 CO

- 左侧切换题库和领域。打开题目后，在原文旁编写 KE。预览支持 Markdown 和 KaTeX 公式，检查栏分别标记语法和语义问题。
- 在原文划选文字，按 `C` 或 `O` 关联概念或算子。选择词条时可插入声明及签名依赖。只有题干的人工作业可以先保存原文和标注，再补齐 KE。
- `Ctrl+Shift+F` 打开 CO 检索。字典汇集领域库、内置 CO，以及当前工作区所有题库和草稿中写过的声明。可按来源筛选和复制声明，在 `concept` 或 `op` 后也能补全无歧义的历史定义。
- 同名 CO 的语义按题内声明和领域作用域判断。父领域与通用库提供共享定义。字典保留冲突签名，方便查看和选择。
- 支持 `.ke` 与 JSON 导入和导出。题干按原文保存。原始题目清单中 11 道圆锥曲线题的裸 TeX 在预览中渲染为公式，编辑和导出使用原文。人工标准例可跟踪经过确认的题目表达。

## 本地文件

```text
ke-workspace.json         工作区与题库索引
shared/domains.json      领域树
shared/libraries/*.keh  各领域的 CO
banks/<题库>/questions/  题目 JSON
banks/<题库>/drafts/     草稿 JSON
banks/<题库>/coke/        人工标准例
banks/<题库>/history.jsonl
trash/                   已删除领域及其文件
```

数据留在所选文件夹，网页和本地版可打开同一工作区。早期的 `shared/language`、模型配置和对话文件仍可从工作区备份中查阅。当前程序以发布时构建的 KE 语言为准。

## 本地运行与开发

也可以下载本地包，安装 Node.js 22 或更新版本后解压并启动。Windows 可双击 `start.cmd`，其他系统运行 `node scripts/start.mjs`。详见[本地运行说明](docs/local.md)。

```sh
git clone https://github.com/SZnine/ke-studio.git
cd ke-studio
npm ci
npm run dev
```

开发地址为 `http://127.0.0.1:4331/ke-studio/`。语法和类型规则在 `studio/language/`，构建时验证并生成语言产物。浏览器工作线程直接使用发布产物。推送 `main` 会构建网页与本地包。

题目来自《新人标注四项_题目清单_20261117.xlsx》，包括几何 50、数论 17、代数 16、圆锥曲线 20 道。初始题库提供题号和题干。
