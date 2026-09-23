# WUDI 去官方化与品牌重塑改造进度记录 (Progress Log)

本文档实时追踪每个改造任务的审查、修改、测试、自审与结论状态。

| Task | 描述 | Files Changed | Reason | Test | Result | Remaining Issue |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Audit** | 官方依赖清单审计 | `docs/wudi-deofficialization-audit.md` | 梳理 18 项官方关键词及其处理策略 | 全仓 grep 交叉比对 | **PASS** | 无 |
| **Task 1** | 全局应用品牌改为 WUDI | `src/shared/brand.ts`, `src/main/main.ts`, `src/main/commands.ts`, `src/renderer/index.html` | 用户可见品牌统一为 WUDI | UI / 菜单 / 窗口标题检查 | **PASS** | 无 |
| **Task 2** | 修改 package.json 产品身份 | `package.json`, `package-lock.json` | 切换包名与产品名 `WUDI`、仓库名 `MdicaL7/SuperCmd`、删除官网 | package 字段验证 | **PASS** | 无 |
| **Task 3** | App ID / Bundle ID 去官方化 | `package.json`, `src/shared/brand.ts`, `src/main/auto-quit-manager.ts`, `src/main/window-manager-worker.ts`, `src/renderer/src/WindowManagerPanel.tsx` | 切换为 `com.mdical7.wudi` 并保留对历史版本的自排除与防平铺保护 | 进程与窗口过滤测试 | **PASS** | 无 |
| **Task 4** | 删除原 SuperCmd Apple 签名身份 | `package.json`, `notarize.js` | 移除硬编码 Developer ID (`Shobhit Bhosure`) 和 Team ID (`T7HT4U4666`)，改为动态读取环境变量 | 配置静态审计 | **PASS** | 无 |
| **Task 5** | 自动更新完全切离 SuperCmdLabs | `src/main/updater-config.ts`, `package.json`, `scripts/test-updater-feed.mjs` | 指向 `MdicaL7/SuperCmd`，运行时严格拒绝 `SuperCmdLabs` | 单元测试 & 静态检查 | **PASS** | 无 |
| **Task 6** | 删除 Aptabase 官方遥测 | `package.json`, `package-lock.json`, `src/main/main.ts` | 移除 `@aptabase/electron`、`initAptabase("A-US-7660732429")` 与所有 `trackEvent` 上报调用 | grep 零残留验证 | **PASS** | 无 |
| **Task 7** | 扩展系统去官方后端化 | `src/main/extension-api.ts` (已删除), `src/main/extension-registry.ts` | 移除 `api.supercmd.sh`，直接从 GitHub Raycast catalog 获取扩展清单和截图 | 扩展获取与离线模拟测试 | **PASS** | 无 |
| **Task 8** | 删除 Extension 安装/卸载上报 | `src/main/extension-registry.ts` | 移除 `reportInstall/Uninstall` 与 `.machine-id` 硬件统计代码 | 调用追踪与零网络请求验证 | **PASS** | 无 |
| **Task 9** | Extension Store UI 继续保留 | `src/main/main.ts`, `src/main/extension-registry.ts` | 保留商店搜索、分类、安装卸载能力，来源切换为 Raycast 官方仓库，IPC 切换为本地直接索引 | Store 逻辑测试 | **PASS** | 无 |
| **Task 10**| Supermemory 保持现状 | `src/main/settings-store.ts`, `src/renderer/src/settings/AITab.tsx` | `api.supermemory.ai` 为用户配置的第三方云/本地记忆，非 SuperCmd 官方服务 | 依赖与配置审查 | **PASS (保留)** | 无 |
| **Task 11**| 第三方 AI / Web 能力全部保留 | `src/main/ai-provider.ts`, `src/main/settings-store.ts` | OpenAI, Gemini, Claude, Ollama, Edge TTS 等服务为第三方公有/本地服务 | 依赖审查 | **PASS (保留)** | 无 |
| **Task 12**| About 改为 WUDI | `src/renderer/src/i18n/locales/*.json` (`settings.general.about.version`) | 关于页面仅展示本地 `WUDI v{version}` | `npm run check:i18n` | **PASS** | 无 |
| **Task 13**| Logo / App Icon / Menu Bar Icon 引入 | `assets/wudi/`, `src/main/brand-assets.ts`, `wudi.icns`, `wudi.png` | 用户提供的 `icon1.png` 与 `菜单栏.png` 已接入，编译生成 `wudi.icns` | 资源尺寸与加载验证 | **PASS** | 无 |
| **Task 14**| Logo 文本与资源引用审计 | `src/main/brand-assets.ts`, `src/renderer/src/utils/command-helpers.tsx`, `src/renderer/src/OnboardingExtension.tsx`, `src/renderer/src/views/AiChatView.tsx`, `src/renderer/src/settings/ExtensionsTab.tsx` | 建立品牌资源解析器，开发与生产打包优雅加载 WUDI 图标 | `npm run build:renderer` | **PASS** | 无 |
| **Task 15**| 浏览器扩展品牌调整 | `browser-extension/manifest.json`, `browser-extension/README.md` | 调整 Extension manifest.json 与说明为 `WUDI Browser Tabs` | 扩展格式检查 | **PASS** | 无 |
| **Task 16**| 协议兼容性 (wudi:// + supercmd://) | `src/main/main.ts`, `src/main/commands.ts`, `src/renderer/src/raycast-api/misc-runtime.ts`, `src/renderer/src/raycast-api/oauth/oauth-bridge.ts`, `docs/wudi-protocol-migration.md` | 默认生成 `wudi://`，同时拦截并重定向 `supercmd://` 与 `raycast://` | URL 协议解析测试 | **PASS** | 无 |
| **Task 17**| 内部代码命名保持稳定性 | `src/main/commands.ts`, `src/renderer/src/utils/command-helpers.tsx` | 仅改动用户可见名称，内部兼容协议与持久化字段不破坏用户已有配置 | 接口兼容性审查 | **PASS** | 无 |
| **Task 18**| 清理原作者发布身份 (保留 LICENSE) | `LICENSE`, `package.json`, `notarize.js` | 移除官方发布与签名归属，严格保留 LICENSE 原作者 Shobhit Bhosure 开源署名 | LICENSE 完整性验证 | **PASS** | 无 |
| **Task 19**| 自动更新行为测试 | `scripts/test-updater-feed.mjs` | 验证 feedConfig 只解析到 `MdicaL7/SuperCmd`，硬拦截 `SuperCmdLabs` | `node --test scripts/test-updater-feed.mjs` (4/4 passed) | **PASS** | 无 |
| **Task 20**| Extension 去官方化测试 | `src/main/extension-registry.ts` | 确保不请求 `api.supercmd.sh` 仍能正常工作 | 单元与本地目录解析测试 | **PASS** | 无 |
| **Task 21**| Aptabase 清理测试 | `package.json`, `package-lock.json`, `src/main/main.ts` | 确保全仓无 aptabase 运行时上报及 App Key | `npm ls @aptabase/electron` 零依赖 | **PASS** | 无 |
| **Task 22**| Build / Regression | 全仓 | main build, renderer build, native build & tests | `npm run build:main`, `npm run build:renderer`, `npm test` (126 passed, 0 failed) | **PASS** | 无 |
| **Task 23**| 额外审计：禁止残留 SuperCmd 官方网络请求 | `docs/wudi-network-endpoints.md`, `src/main/main.ts`, `src/renderer/src/ExtensionView.tsx` | 扫描所有 http/https 链接，移除 S3 依赖，Canvas 改为离线包 | 静态全仓 URL 扫描 | **PASS** | 无 |
| **Task 24**| 最终品牌静态审计 | `docs/wudi-brand-audit.md` | 扫描并解释所有残留 SuperCmd 字符串（协议别名、许可证、肌肉记忆搜索） | 全仓正则扫描与人工复核 | **PASS** | 无 |
| **Task 25**| 无关功能保持不变 | 全仓 | File Shelf 业务逻辑、AI 架构等不作侵入变更 | Git Diff 审查 | **PASS (遵守)** | 无 |
| **Task 26**| File Shelf gesture lifecycle 审计与测试 | `src/main/file-shelf-store.ts`, `scripts/test-file-shelf.mjs` | 审查 child error, stale child, backoff, single process guarantee | `test-file-shelf.mjs` (16/16 passed) | **PASS** | 无 |
