# KE Studio 本地版

1. 安装 [Node.js 22 或更新版本](https://nodejs.org/)。
2. 将 `ke-studio-local.zip` 完整解压到一个文件夹。
3. Windows 双击 `start.cmd`；macOS/Linux 在解压目录运行 `node scripts/start.mjs`。
4. 使用桌面版 Edge 或 Chrome 打开启动后显示的网址，选择自己的保存文件夹。

本地默认地址：`http://127.0.0.1:4340/ke-studio/`。关闭启动终端或按 Ctrl+C 即可停止。

运行包已经构建完成，无需安装 npm 依赖。编辑器、语法编译和 CO 功能在本机运行；模型对话需要联网到自己配置的 API。接口、模型与密钥在“模型设置”填写。

题库、领域、CO 和语法保存到用户选择的文件夹。更新时覆盖运行包中的程序文件，再选择原保存文件夹继续使用；如果数据就在程序目录内，保留 `shared`、`banks`、`settings`、`trash` 和 `ke-workspace.json`。网页版与本地版可打开同一份工作区；模型密钥需在各自的浏览器地址下重新设置。

原文右上角可切换“预览 / 编辑”，预览同时显示 Markdown、公式和已有 C/O 标注。每条标注旁的 × 可直接删除关联。原文工具使用 C／O 双画笔（再次点击可取消）：选一次 CO 后连续划选，点击高亮查看或更换关联。找不到的 CO 可直接新建；签名不完整的算子保存为“待完善”，补齐后再参与补全与检查。

端口被占用时，可在 PowerShell 中执行：

```powershell
$env:PORT = 4341
node scripts/start.mjs
```

## 二次开发

[源码仓库](https://github.com/SZnine/ke-studio) · [开发说明](https://github.com/SZnine/ke-studio/blob/main/CONTRIBUTING.md)

```sh
git clone https://github.com/SZnine/ke-studio.git
cd ke-studio
npm ci
npm run dev
```

源码开发地址为 `http://127.0.0.1:4331/ke-studio/`。修改文件后自动构建，刷新浏览器查看。构建自己的本地包运行 `npm run package:local`。

首次使用新的空保存目录时，默认数学题库含 103 道题干，答案留空。更新程序保留已有题库。
