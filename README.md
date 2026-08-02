# 折简 · JamMarkdown

> 一款基于 [Tauri v2](https://tauri.app) 打造的轻量级 Markdown 编辑器与阅读器。安静、克制，专注于文字本身。

<p align="center">
  <img src="logo/logo.png" alt="折简 logo" width="96" height="96" />
</p>

<p align="center">
  <a href="#安装"><img src="https://img.shields.io/badge/platform-Windows-blue" alt="Platform" /></a>
  <a href="#技术栈"><img src="https://img.shields.io/badge/built%20with-Tauri%202-2C2E3B" alt="Built with Tauri 2" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/arch-x86%20%7C%20x64-orange" alt="Arch: x86 | x64" />
</p>

---

## ✨ 特性

- **实时渲染** —— 基于 [marked](https://github.com/markedjs/marked) v12，完整支持 GitHub Flavored Markdown（表格、任务列表、代码块、引用、脚注等）。
- **代码高亮** —— 离线内置 [highlight.js](https://highlightjs.org) 11.9，提供浅色 / 深色双主题，无需联网。
- **数学公式** —— 集成 [KaTeX](https://katex.org) 0.16，支持行内 `$…$` 与块级 `$$…$$` 公式，含矩阵。
- **图表绘制** —— 集成 [Mermaid](https://mermaid.js.org) 9.4，支持流程图 / 时序图 / 饼图 / 甘特图 / 类图（按需懒加载）。
- **源码模式** —— 渲染视图与源码编辑一键切换，单一数据源，切换不丢失内容。
- **大纲导航** —— 侧栏自动提取文档标题，点击平滑滚动并高亮定位当前章节。
- **偏好设置** —— 正文字体、字号、行高、浅色 / 深色主题，自动记忆。
- **无边框窗口** —— 自定义最小化 / 最大化 / 关闭按钮，顶栏可整条拖动；左上角显示应用图标。
- **文件关联** —— 安装后系统默认以「折简」打开 `.md` / `.markdown`（双击即可）；已开窗口自动转发，保持单实例。
- **空状态引导** —— 未打开文件时居中显示文艺文案与「打开 / 新建」入口。

## 📦 安装

提供两种分发形态，**均包含 x86（32 位）与 x64（64 位）版本**：

| 形态 | 文件 | 说明 |
| --- | --- | --- |
| 安装版（Setup） | `折简_x64_setup.exe` / `折简_x86_setup.exe` | NSIS 安装包，写入「开始菜单」并注册 `.md` 文件关联 |
| 绿色版（Portable） | `折简_x64_portable.zip` / `折简_x86_portable.zip` | 解压即用，单文件可执行，不写注册表，适合 U 盘携带 |

> 绿色版为单文件可执行程序，运行时依赖系统中已安装的 **Microsoft Edge WebView2 Runtime**（Windows 10 / 11 通常已自带；若缺失，安装版会在首次启动时提示安装）。

## ⌨️ 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl/Cmd + S` | 保存当前文档 |
| `Ctrl/Cmd + O` | 打开 Markdown 文件 |
| 右下角工具轨 | 源码 / 大纲 / 设置 / 打开 / 保存 / 回到顶部 |

## 🛠 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Rust + Tauri v2（WebView2 渲染引擎） |
| 前端 | 原生 HTML / CSS / JavaScript（无框架、无打包器） |
| Markdown 解析 | marked v12（离线内置） |
| 语法高亮 | highlight.js 11.9（离线内置） |
| 公式渲染 | KaTeX 0.16（离线内置） |
| 图表渲染 | Mermaid 9.4（离线内置，懒加载） |
| 安装包 | NSIS |

所有第三方前端库均以 UMD 形式离线内置在 `src/vendor/` 中，构建后随前端一并打进二进制，运行时不依赖网络。

## 🏗 从源码构建

### 环境要求

- **Rust**（stable 工具链，含 `x86_64-pc-windows-msvc`；构建 32 位版本需额外 `i686-pc-windows-msvc`）
- **Node.js** ≥ 18
- **Visual Studio 2022 Build Tools**，勾选：
  - 「MSVC v143 - VS 2022 C++ x86/x64 生成工具」
  - 「Windows 10 / 11 SDK」
- **NSIS**（仅打包安装版时需要）

### 构建步骤

```bash
# 1. 安装前端工具链（Tauri CLI）
npm install

# 2. 开发预览（热重载）
npm run dev

# 3. 构建安装版（同时产出绿色版单文件 exe）
#    x64
npm run build -- --target x86_64-pc-windows-msvc --bundles nsis
#    x86（32 位）
npm run build -- --target i686-pc-windows-msvc   --bundles nsis
```

构建产物位置：

```
src-tauri/target/<target>/release/bundle/nsis/    # 安装版（.exe）
src-tauri/target/<target>/release/jam_md_view.exe # 绿色版单文件（压缩分发即可）
```

> 注：Rust/Cargo 的包名必须是 ASCII 标识符，故编译产物二进制名为 `jam_md_view.exe`；窗口标题、任务栏与安装包显示名均由 `productName` 控制，显示为「折简」。

## 📁 目录结构

```
jam_md_view/
├── logo/                     # 应用图标源文件（logo.png）
├── src/                      # 前端（编译后由 Tauri 打进二进制）
│   ├── index.html            # 界面结构
│   ├── styles.css            # 样式（含浅色 / 深色主题变量）
│   ├── app.js                # 前端交互逻辑
│   ├── markdown-examples.md  # Markdown 格式示例（含公式与图表）
│   └── vendor/               # 离线内置的前端库（marked / hljs / katex / mermaid）
├── src-tauri/                # Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json       # 应用与打包配置
│   ├── capabilities/         # 权限声明
│   ├── icons/                # 应用图标（icon.ico / icon.png）
│   └── src/
│       ├── lib.rs            # 后端逻辑、命令、文件关联与单实例
│       └── main.rs
├── package.json
└── README.md
```

## 🗺 路线图

- [ ] 导出 PDF / HTML
- [ ] 全文搜索与替换
- [ ] 自定义主题与导入
- [ ] 多标签页 / 工作区

欢迎通过 Issue 提出需求与建议。

## 📄 许可证

本项目以 [MIT 许可证](LICENSE) 开源。

## 🤝 贡献

欢迎提交 Issue 与 Pull Request。提交前请先阅读已有 Issue，避免重复；如需较大改动，建议先开 Issue 讨论。

---

<p align="center">用「折简」，让每一段文字都安静地落定。</p>
