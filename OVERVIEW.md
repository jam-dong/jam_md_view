# JamMarkdown — 开发概述

基于 **Tauri v2** 的轻量级 Markdown 编辑 / 查看应用，只保留最核心的「编辑 + 查看」能力。

本轮在前几轮「界面重设计 + 源码切换 bug 修复 + 打开保存修复」的基础上，新增了渲染增强与窗口改造：代码高亮、数学公式（KaTeX）、图表（Mermaid）、空状态、滚动条归位到窗口最右侧，以及去除系统标题栏改用右上角自定义最小化/最大化/关闭按钮。

## 已实现功能
- **渲染查看**：主区域实时渲染 Markdown（内置 `marked` v12，支持 GFM：表格、任务列表、代码块、引用等），居中阅读栏
- **代码高亮**：代码块经 highlight.js 11.9 语法高亮，自动识别语言（js / py / rust / bash / json 等）
- **数学公式**：行内 `$…$` 与块级 `$$…$$` 公式经 KaTeX 0.16 渲染（含矩阵、分式等），渲染前用 PUA 哨兵字符保护避免与 Markdown 解析冲突
- **图表**：围栏 ```mermaid``` 代码块经 Mermaid 9.4 渲染流程图/时序图/饼图/甘特图/类图（按需懒加载，避免初始化开销）
- **空状态**：直接启动应用（未载入文件）时居中显示文艺文案与「打开 / 新建」按钮；打开或新建后切换为文档视图
- **滚动条归位**：滚动容器从 `.preview`/`.source` 上移到 `.content`，WebView 滚动条贴合窗口最右侧
- **源码模式**：工具轨「源码」在「渲染视图 / 源码编辑」之间切换；切换基于 CSS 类，单一数据源保证内容不丢失
- **大纲导航**：工具轨「大纲」从左侧滑出文档标题，点击标题平滑滚动到对应位置
- **偏好设置**：工具轨「设置」从右侧滑出抽屉，使用分段按钮选择字体/主题，自动记忆（localStorage）
- **打开 / 保存**：顶部按钮或右下工具轨「打开 / 保存」按钮触发；`Ctrl/Cmd + S` 保存、`Ctrl/Cmd + O` 打开；保存成功后顶部居中弹出「已保存」toast 提示
- **回到顶部**：右下工具轨「回到顶部」按钮平滑滚动阅读区至顶端
- **无边框窗口**：`decorations:false` 去除系统标题栏与边框；右上角自定义最小化/最大化/关闭按钮（基于 `getCurrentWindow()` API），顶栏含 `data-tauri-drag-region` 可拖动
- **文件关联**：安装后系统默认用本应用打开 `.md` / `.markdown`（双击即可）；单实例，已开窗口中转发的文件在原窗口打开

## 技术要点
- **前端**：原生 HTML / CSS / JS，无打包器；通过 `withGlobalTauri: true` 暴露的全局 `window.__TAURI__` 调用 `invoke` / `dialog`
- **后端（Rust）**：命令 `save_file` / `read_file` / `get_initial_file`；`tauri-plugin-single-instance` 解析命令行 argv / 转发文件关联；`tauri-plugin-dialog` 打开保存对话框
- **图标**：`tools/gen_icon.py`（纯标准库）生成占位 `icon.ico` / `icon.png`

## 构建与运行
```bash
npm install          # 安装 @tauri-apps/cli
npm run build        # 编译 + 嵌入前端 + 生成安装包（需 NSIS 或 WiX 以注册 .md 关联）
```
> 仅想编译检查 Rust：`cd src-tauri && cargo build`（注意：Tauri v2 的 `cargo build` **不会**把前端嵌入二进制，前端必须由 `tauri build` / `tauri dev` 嵌入）。

双击打开 `.md` 依赖安装包注册文件关联，因此需先 `npm run build` 生成安装程序并安装；未安装时可用顶部「打开」按钮或直接把文件拖入使用。

## 验证结果
- `npm run build`（临时将 `bundle.active` 置 `false` 跳过安装包）成功产出 `src-tauri/target/release/jam_md_view.exe`，启动后保持运行、可正常关闭，无崩溃；前端已正确嵌入
- Playwright 验证前端逻辑 PASS：空状态可见、新建文档后进入源码模式、highlight.js 高亮生效、KaTeX 行内与块级公式渲染、Mermaid 导出 svg、`.content` 为滚动容器且 `.preview` 不再自带滚动条、控制台无报错
- JS 语法校验通过；临时验证脚本与截图已清理
- 权限坑修复：`capabilities/default.json` 中误用的 `core:window:allow-set-maximize` 在已装 Tauri 版本不存在，改为 `allow-toggle-maximize`（`win-max` 按钮调用 `toggleMaximize()`），构建通过

## 关键文件
| 文件 | 作用 |
| --- | --- |
| `src/app.js` | 前端交互（渲染/高亮/公式/图表/空状态/源码切换/大纲/设置/打开保存/窗口控制） |
| `src/index.html` / `src/styles.css` | 界面结构、空状态、自定义窗口按钮与样式 |
| `src/vendor/` | 离线内置：marked / highlight.js / KaTeX(+字体) / Mermaid |
| `src-tauri/src/lib.rs` | 后端逻辑、命令、`.md` 文件关联与单实例转发 |
| `src-tauri/tauri.conf.json` | 应用配置（含 `decorations:false`、`bundle.fileAssociations`、CSP、窗口） |
| `src-tauri/capabilities/default.json` | 权限（含窗口 min/max/close/drag 等） |
| `tools/vendor_libs.mjs` | 从 CDN 拉取并落地 vendor 库的脚本（可重跑以更新依赖） |
| `tools/gen_icon.py` | 占位图标生成脚本 |
| `markdown-examples.md` | 含全部 Markdown 格式示例（含公式与图表）的示例文档 |
