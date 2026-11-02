# 心灵终结规则编辑器

一个在本地运行的《心灵终结》规则编辑器，提供 Windows 免安装版和浏览器版，帮助你查找、修改和创建规则对象。

编辑器不包含游戏规则或美术资源。导入自己的游戏目录后，可以读取其中的规则、中文名称和支持的图标资源。

## 功能

- 按中文名、英文名或代码搜索单位、建筑、超级武器、武器、投射物、弹头和全局参数。
- 编辑规则字段，从已有对象复制或新建对象，并沿关联关系查看配置。
- 使用运输、驻军、科技建筑等快捷功能配置多项相关字段。
- 检查建造条件、对照武器与目标装甲，并在复制关联对象前预览影响范围。
- 桌面版直接保存到游戏目录，自动备份文件，并支持查看历史差异和恢复版本。

## 下载与使用

1. 从 [GitHub Releases](https://github.com/xxxsen/mo-editor/releases) 下载 Windows 免安装程序 `MentalOmegaEditor.exe`。
2. 运行程序并选择游戏目录，例如 `D:\MentalOmega`。Windows 需要安装 WebView2 运行时。
3. 搜索要修改的对象，编辑后点击「保存」或按 `Ctrl+S`。也可以通过「另存为」输出到其他目录。

保存前程序会备份被覆盖的文件。若目录中没有独立的 `rulesmo.ini`，编辑器会尝试从所选 MIX 中读取；保存时生成独立 INI，不会修改 MIX。游戏内的实际效果仍需验证。

浏览器版可以从源码在本地运行，修改后需要下载文件；启动方法和更多操作见[使用指南](docs/user-guide.md)。

## 文档

- [使用指南](docs/user-guide.md)：打开游戏目录、编辑对象、保存和恢复历史版本。
- [规则与兼容性](docs/rules-reference.md)：快捷功能涉及的规则、资源读取和已知限制。
- [开发与发布](docs/development.md)：项目结构、本地构建、测试和 GitHub Release 工作流。

## 开发

从源码构建 Windows 桌面版需要 Node.js、Rust MSVC 工具链、Visual Studio C++ Build Tools 和 WebView2：

```powershell
npm ci
npm run desktop:dev
```

运行自动测试：

```sh
npm test
```

构建及其他验证方法见[开发文档](docs/development.md)。

## 许可证

本仓库目前尚未提供许可证文件。
