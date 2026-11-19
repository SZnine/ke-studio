# 二次开发

使用 Node.js 22 或更新版本开发。MIT 许可允许修改和分发。

```sh
git clone https://github.com/SZnine/ke-studio.git
cd ke-studio
npm ci
npm run dev
```

打开终端中的开发地址，选择保存文件夹。保存 `src/`、`web/`、`studio/`、`initial/` 下的文件后会自动构建。可用 `npm run preview` 预览 `dist/`。

| 要改什么                     | 入口                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| 语法结构、运算优先级、标点   | `studio/language/ke.langium`                                  |
| 类型、名称作用域、语义检查   | `studio/language/profile.ts`、`semantic.ts`                   |
| 内置算子和类型               | `studio/language/core.keh`                                    |
| 补全、签名、高亮和格式化     | `studio/language/editor.ts`                                   |
| 初始领域和 CO                | `initial/shared/domains.json`、`initial/shared/libraries/`    |
| 发布版数学 CO                | `studio/co-seed/`                                            |
| 页面、Monaco、主题、面板交互 | `web/studio/`                                                 |
| 文件存储、题库、领域继承     | `src/studio/store.ts`、`files.ts`、`domains.ts`               |
| CO 检索与历史声明索引       | `src/studio/co-catalog.ts`、`web/studio/dictionary.ts`         |
| 发布语言产物                 | `studio/compile-grammar.mjs`、`src/studio/engine.ts`          |
| 主线程与后台业务通信         | `web/studio/api.ts`、`src/studio/worker.ts`                   |

发布语言和工作区数据独立维护。构建校验文法并生成解析器配置，工作线程使用同一份语言服务检查所有已挂载题库。语言升级通过 Git 发布。早期工作区的语言文件和其他历史数据留在原位置。

补全请求使用工作区准备好的内存快照，按当前领域继承 CO。全局 CO 声明索引在工作区打开后读取题目、草稿和标准例。检索和显式声明补全可以使用索引，语义检查以题内声明和领域作用域为依据。

在网页中维护领域和 CO 后，可用 `npm run template -- "工作区文件夹"` 更新初始化模板。脚本读取共享领域及其 CO。

## 检查与打包

```sh
npm run check
npm test
npm run build
npm run test:site
```

可用 `node scripts/benchmark-editor.mjs "工作区文件夹"` 测量当前题库的补全服务耗时和文件读取次数。它只读已有题目，以只读方式运行，结果不包含原文；测量不包含浏览器绘制和浏览器文件系统通信。

网站输出到 `dist/`。`npm run test:site` 验证静态资源和 Pages 路径。

浏览器回归可运行 `node scripts/browser-check.mjs`，再用本地服务打开 `/ke-studio/check.html`。它使用隔离的浏览器文件系统。再次正式构建会移除验证页面。

推送 `main` 后，GitHub Actions 检查并更新 Pages。提交前检查差异，只提交源码和确认可公开的模板。运行数据和构建产物已加入 `.gitignore`。
