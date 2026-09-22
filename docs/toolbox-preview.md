# 本地工具箱体验版

统一使用 SuperCmd 搜索入口，可搜索“翻译”“截图”“文件中转站”，也可在现有快捷键设置中为各命令分配快捷键。

## 启动

在 `/Users/dicam/CodeDir/MyBar/SuperCmd` 运行：

```sh
npm run build:main
npm run build:renderer
SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.1.sdk npm run build:toolbox-native
SUPERCMD_DEV_USER_DATA=/tmp/mybar-toolbox-qa/profile npm run preview:toolbox
```

这是源码目录内的本地 Electron 体验版，不需要安装 DMG。独立 profile 不读取或覆盖正式版设置，也不注册正式版 `supercmd` URL 协议。退出后文件中转清单保存在该 profile；贴图不恢复。翻译复用应用现有 AI 设置，请在体验版的 AI 设置中配置可用模型。开发热更新也可使用 `SUPERCMD_DEV_USER_DATA=/tmp/mybar-toolbox-qa/profile npm run dev`。

`build:toolbox-native` 只编译新增的三个 helper，不下载语音模型。完整应用的其他原生 helper 仍使用项目原有 `build:native`；当前本地目录已有基础 helper。SDK 路径是本机 Xcode 版本，其他机器需改为其可用 SDK。

## 功能与验收

- 翻译：手动输入、当前选区、截图翻译。截图只捕获一次，本地 Vision OCR 后仅发送文本到已配置模型。当前选区只读取当前前台焦点，不复制、不读取历史。关闭或取消后迟到结果不会重开窗口。
- 截图：区域、窗口、鼠标所在显示器。区域/窗口使用 macOS 系统选择器与高亮；不做组件吸附。预览支持复制图片、保存 PNG、贴图、OCR、翻译。多张贴图独立关闭，失焦保留，可拖标题栏移动及等比调整大小。
- 文件中转：拖入 Finder 文件/目录，保存引用而不移动源文件；支持多选、复制真实文件引用、原生拖出、Finder 定位、置顶与清空列表。丢失文件可见并可移除，退出后清单和窗口位置恢复。

首次截图需要屏幕录制权限；选区读取需要辅助功能权限。系统拒绝权限、空选区和空 OCR 都应显示可处理的状态。API 配置失败保留原文，可修改后重试。

自动验证：

```sh
SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.1.sdk SUPERCMD_SKIP_ELECTRON_TESTS=1 npm test
npm run check:i18n
```

新增测试覆盖翻译取消/重试/并发、当前焦点读取、截图引用计数/取消/重复使用/关闭竞态和文件清单保存/源文件保留。实时 GUI 验收需另外检查 Finder 拖入拖出、多显示器捕获、系统选区高亮、贴图缩放与外部应用选中文字。

已知基线：全仓 renderer 类型检查有既存错误；意大利语缺两项原有键 `settings.ai.whisper.vocabulary` 和 `settings.extensions.appSearchScope`。新增模块以主进程构建、renderer 打包、定向测试和新增十语种文案完整性验证。
