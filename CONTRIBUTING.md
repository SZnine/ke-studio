# 二次开发

Node.js 22 或更新版本。网页和本地包由同一份源码构建，MIT 许可允许修改和分发。

```sh
git clone https://github.com/SZnine/ke-studio.git
cd ke-studio
npm ci
npm run dev
```

打开终端中的本地地址，选择保存文件夹。保存 `src/`、`web/`、`studio/`、`initial/` 下的文件后会自动构建；完成后刷新浏览器。运行已构建的应用可用 `npm start` 或双击 `start.cmd`。

| 要改什么                     | 入口                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| 语法结构、运算优先级、标点   | `studio/language/ke.langium`                                  |
| 类型、名称作用域、语义检查   | `studio/language/profile.ts`、`semantic.ts`                   |
| 内置算子和类型               | `studio/language/core.keh`                                    |
| 补全、签名、高亮和格式化     | `studio/language/editor.ts`                                   |
| 初始领域和 CO                | `initial/shared/domains.json`、`initial/shared/libraries/`    |
| 页面、Monaco、主题、面板交互 | `web/studio/`                                                 |
| 文件存储、题库、领域继承     | `src/studio/store.ts`、`files.ts`、`domains.ts`               |
| 模型对话、工具、建议审核     | `src/studio/assistant.ts`、`assistant-tools.ts`、`reviews.ts` |
| 模型流式接口                 | `src/studio/model.ts`                                         |
| 主线程与后台业务通信         | `web/studio/api.ts`、`src/studio/worker.ts`                   |

语言源码构建时进入发布模板，`language-defaults.json` 仅收录 Git 中的默认文件指纹。已有工作区通过指纹识别并更新未修改的默认语言文件；首次同步后使用工作区基线，保留后续自定义和主动恢复的旧文件。GitHub Actions 获取完整提交历史，源码压缩包构建则只追踪当前默认文件。同步需通过编译、CO 和人工标准例校验，并写入已有修改日志。领域 CO、题目与用户规则不因新模板被覆盖；不要通过删除用户数据刷新模板。

补全请求使用工作区加载时准备的 CO 内存快照，不读取文件、不等待保存队列。领域、CO、使用频率或语言变化后生成新的快照；同一文本和范围的语义分析供补全、签名、高亮共同使用。保持这条输入路径简短，完整工作区刷新仍由后台读取完成。

在网页中维护好的领域、CO 和语法，可用 `npm run template -- "工作区文件夹"` 更新发布模板。该命令只读取共享资源。

## 检查与打包

```sh
npm run check
npm test
npm run package:local
```

可用 `node scripts/benchmark-editor.mjs "工作区文件夹"` 测量当前题库的补全服务耗时和文件读取次数。它只读已有题目，不调用模型、不写工作区，结果不包含原文；测量不包含浏览器绘制和浏览器文件系统通信。

本地包输出到 `release/ke-studio-local.zip`；纯网页输出在 `dist/`。`npm run test:local` 验证本地启动、静态资源以及运行包结构。

浏览器回归可运行 `node scripts/browser-check.mjs`，再用本地服务打开 `/ke-studio/check.html`。它使用隔离的浏览器文件系统，不需要真实模型或个人题库。再次正式构建会移除验证页面。

推送 `main` 后，GitHub Actions 检查并更新 Pages 与同一个 `local` 发行包。历史改动保留在 Git 提交记录中。提交前检查差异，只提交源码和确认可公开的模板；运行数据和构建产物已加入 `.gitignore`。
