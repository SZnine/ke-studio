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

语言源码构建时进入初始模板；已有工作区不会被新模板覆盖。修改语法后，可选择一个空的验证文件夹，或将需要修改的语言文件导入已有工作区的“语言”页并应用。不要通过删除用户数据来刷新模板。

在网页中维护好的领域、CO 和语法，可用 `npm run template -- "工作区文件夹"` 更新发布模板。该命令只读取共享资源。

## 检查与打包

```sh
npm run check
npm test
npm run package:local
```

本地包输出到 `release/ke-studio-local.zip`；纯网页输出在 `dist/`。`npm run test:local` 验证本地启动、静态资源以及运行包结构。

浏览器回归可运行 `node scripts/browser-check.mjs`，再用本地服务打开 `/ke-studio/check.html`。它使用隔离的浏览器文件系统，不需要真实模型或个人题库。再次正式构建会移除验证页面。

推送 `main` 后，GitHub Actions 检查并更新 Pages 与同一个 `local` 发行包。历史改动保留在 Git 提交记录中。提交前检查差异，只提交源码和确认可公开的模板；运行数据和构建产物已加入 `.gitignore`。
