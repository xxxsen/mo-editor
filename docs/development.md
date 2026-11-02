# 开发与发布

## 环境和本地运行

Windows 桌面开发需要 Node.js、Rust MSVC 工具链（最低 Rust 1.90）、Visual Studio C++ Build Tools 和 WebView2。GitHub Actions 使用 Node.js 24 和 Windows MSVC 目标。具体依赖参见 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)。

在 Windows 的项目目录中运行：

```powershell
npm ci
npm run desktop:dev
```

构建 Windows 免安装程序：

```powershell
npm run desktop:build
```

构建结果为 `dist/MentalOmegaEditor.exe`；Tauri 原始输出位于 `src-tauri/target/release/mental-omega-editor.exe`。`desktop:prepare` 会将 `index.html` 和 `src/` 复制到 `desktop-dist/` 供桌面构建使用。`dist/`、`desktop-dist/`、`node_modules/` 和 Rust 构建产物不会提交到仓库。

浏览器版可以直接运行 `npm start` 或使用 Python 静态服务器，访问 `http://127.0.0.1:4173/`。完整操作见[使用指南](user-guide.md)。

## 项目结构

| 路径 | 职责 |
| --- | --- |
| `src/app.js`、`src/style.css` | 界面、交互和对象导航 |
| `src/ini.js`、`src/resources.js` | INI 解析与保留原格式的序列化；MIX、CSF、PCX 等资源读取 |
| `src/field-metadata.js`、`src/field-catalog.js`、`src/enum-options.js`、`src/rule-schema.js` | 字段中文说明、可添加字段、选项和规则目录 |
| `src/quick-features.js` | 快捷功能的适用类型、字段、建议值和预览校验 |
| `src/phobos-fields.js`、`src/phobos-warhead-fields.js`、`src/phobos-version.js`、`src/phobos-warheads.js` | Phobos 字段字典、DLL 版本读取及额外弹头的有序配置 |
| `src/object-creation.js`、`src/object-impact.js`、`src/weapon-references.js`、`src/warhead-superweapons.js`、`src/warhead-references.js` | 对象创建、关联复制和规则对象引用 |
| `src/rule-analysis.js`、`src/history-diff.js` | 建造与武器对照、历史快照差异 |
| `src/desktop.js`、`src-tauri/src/main.rs` | 前端桌面接口和 Tauri 命令 |
| `src-tauri/src/store.rs` | 本地目录访问、保存、备份与恢复 |
| `tests/` | Node.js 单元测试及浏览器交互检查页面 |

字段对照表按单位、武器、投射物、弹头、超级武器、国家和全局规则段分组，每项依次为 `[中文名, 作用说明, 可选搜索别名, 可选常显提示]`。同名字段按对象类型或规则段匹配，编号武器、炮塔、加特林阶段、扩展装甲等由规则处理。新增字段和固定选项时，应确认引擎版本、适用对象、单选或多选语义，以及未知值保留行为。

可添加字段目录汇总字段字典和当前项目同类对象的字段；目录不能保证涵盖所有字段，实际支持情况取决于游戏和扩展版本。字段含义主要依据原版 `rulesmd.ini` 注释、[Ares 文档](https://ares-developers.github.io/Ares-docs/)和 [Phobos 0.4 文档](https://phobos.readthedocs.io/en/v0.4/)。

## 测试

运行 Node.js 单元测试：

```sh
npm test
```

在具备 Windows 桌面构建环境时，可运行 Rust 文件存储测试：

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

浏览器交互检查位于 `tests/*-check.html`。启动静态服务器后，通过 `http://127.0.0.1:4173/tests/<文件名>` 打开，页面显示 `PASS` 或 `FAIL`。常用检查包括：

- `browser-check.html`、`desktop-check.html`：导入、编辑、保存、备份、恢复及多文件处理。
- `navigation-check.html`、`scroll-check.html`、`superweapon-ime-check.html`：导航、滚动位置和中文输入。
- `object-creation-check.html`、`projectile-check.html`、`weapon-warheads-check.html`：新增对象及武器、弹头、投射物关联。
- `quick-features-check.html`、`quick-features-extended-check.html`、`tech-buildings-check.html`、`quick-default-reset-check.html`：快捷功能、科技建筑及恢复默认值。
- `analysis-check.html`：建造条件、武器效果和关联复制。
- `phobos-check.html`、`phobos-desktop-check.html`、`warhead-launchsw-check.html`、`warhead-references-check.html`：护盾选择、额外弹头、弹头关联、尾迹及跨主文件的桌面保存保护。
- `field-catalog-check.html`、`field-metadata-check.html`、`enum-choice-check.html`：字段目录、中文说明和选项编辑。
- `resource-check.html`、`rules-source-check.html`、`main-file-picker-check.html`：资源、规则来源及主文件选择。
- `structured-check.html`、`global-search-check.html`、`all-objects-search-check.html`、`garrison-weapons-check.html`：结构化设置、搜索和驻军武器。

## GitHub Release

将包含发布工作流的提交推送到 GitHub，再推送标签即可触发 [Release 工作流](../.github/workflows/release.yml)。例如，将 `vX.Y.Z` 替换为实际版本：

```sh
git push origin master
git tag -a vX.Y.Z -m 'Release vX.Y.Z'
git push origin vX.Y.Z
```

工作流在 Windows 上安装依赖、运行 `npm test`、构建免安装版，并创建对应的 GitHub Release。每个标签的附件都使用固定名称 `MentalOmegaEditor.exe`，版本由标签和 Release 页面区分；推送标签不会修改项目内部版本号。工作流使用 GitHub 自动提供的令牌，需要仓库允许 Actions 运行并授予创建 Release 所需的内容写入权限。
