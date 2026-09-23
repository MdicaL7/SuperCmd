# SuperCmd 官方依赖与品牌标识审计清单 (WUDI De-Officialization Audit)

本文档在开始任何代码变更前生成，对仓库中与 SuperCmd 官方发布、服务、遥测、身份及标识相关的关键项进行全仓扫描与分类审计。

## 审计汇总表格

| 关键词 / 项目 | 当前代码中实现与分布 | 是否联网 | 是否属于 SuperCmd 官方 | 本次处理方式 |
| :--- | :--- | :--- | :--- | :--- |
| **SuperCmd** | 1. `package.json` (`name`, `productName`, `description`)<br>2. 应用显示名称、菜单、托盘提示、设置窗口、About 页面、命令列表标题、系统通知<br>3. `User-Agent: SuperCmd` 请求头<br>4. LICENSE 版权声明与历史兼容引用 | 否 (本地品牌) | 是 | 区分处理：<br>- 用户可见品牌全面替换为 **WUDI**<br>- 内部运行时兼容标识（如本地进程匹配、兼容路径）做安全兼容支持<br>- LICENSE 中原作者著作权严格保留 |
| **SuperCmdLabs** | 1. `package.json` (`repository`, `build.publish.owner`)<br>2. `README.md`, `CONTRIBUTING.md`, `SECURITY.md` 中的 GitHub 链接与 Issues | 是 (GitHub 仓库指向) | 是 | - `package.json` 中的 repository 与 updater publish 切换为 `MdicaL7/SuperCmd`<br>- 文档与配置中移除官方组织引用 |
| **supercmd.sh** | 1. `package.json` (`homepage`)<br>2. `src/main/canvas-store.ts` (`source`)<br>3. `README.md`, `SECURITY.md` 中的官网与联系邮箱 | 是 (官方站点) | 是 | - 从 `package.json` 中彻底删除 `homepage`<br>- 清理代码中的官方站点硬编码，无官方主页时不虚构 |
| **api.supercmd.sh** | 1. `src/main/extension-api.ts` (核心 API 基地址)<br>2. `src/renderer/src/raycast-api/oauth/oauth-service.ts` 及 `oauth-service-core.ts` (OAuth authorizeUrl)<br>3. `docs/extension-install-flow.md`, `SECURITY.md` | 是 (官方后端服务) | 是 | - 彻底删除 `src/main/extension-api.ts`<br>- 移除所有对 `https://api.supercmd.sh` 的请求<br>- 扩展获取全面切换至 Raycast 官方 GitHub 仓库直接下载与本地构建<br>- 清理 OAuth 服务中的官方代理地址 |
| **com.supercmd.app** | 1. `package.json` (`build.appId`)<br>2. `notarize.js` (`appBundleId`)<br>3. `src/main/main.ts` (Aerospace 窗口查询、自身进程过滤)<br>4. `src/main/auto-quit-manager.ts` (自保活过滤名单) | 否 (macOS Bundle ID) | 是 | - 主 Bundle ID 改为自有命名空间 `com.mdical7.wudi`<br>- 在窗口管理、Aerospace、自排除等自识别逻辑中，同时匹配 `com.mdical7.wudi` 并保留对 `com.supercmd.app` 的兼容识别 |
| **T7HT4U4666** | 1. `package.json` (`build.mac.notarize.teamId`)<br>2. `package.json` (`build.mac.identity`) | 否 (Apple Team ID) | 是 | - 从 `package.json` 中彻底移除硬编码的 Apple Team ID，签名应由构建环境/CI 注入，不填虚构 Team ID |
| **Shobhit Bhosure** | 1. `package.json` (`author`, `build.mac.identity`)<br>2. `LICENSE` (MIT/ISC 版权声明) | 否 (开发者身份) | 是 | - `package.json` 中移除原作者发布身份与签名信息<br>- `LICENSE` 中的 Copyright 依法保留，不作侵入式修改 |
| **nullbytes00** | `package.json` (`author` 社交账号链接) | 否 | 是 | - 从 `package.json` 的 `author` 字段中移除 |
| **Aptabase** | 1. `package.json` (`dependencies: "@aptabase/electron"`)<br>2. `src/main/main.ts` (初始化与事件追踪)<br>3. `SECURITY.md`, `README.md` (遥测说明) | 是 (第三方遥测上报，由官方账户配置) | 是 (官方上报实例) | - 彻底删除 `@aptabase/electron` 依赖<br>- 从 `package.json` 和 `package-lock.json` 中移除<br>- 删除 main.ts 中的 import、init 和 trackEvent 调用 |
| **A-US-7660732429** | `src/main/main.ts` (`initAptabase("A-US-7660732429")`) | 是 (官方 Aptabase App Key) | 是 | - 完全删除，确保全仓 grep 0 残留 |
| **trackEvent** | `src/main/main.ts` (`trackEvent("app_started")`) | 是 (启动事件上报) | 是 | - 完全删除调用代码 |
| **initAptabase** | `src/main/main.ts` (`initAptabase(...)`) | 是 | 是 | - 完全删除初始化逻辑 |
| **reportInstall** | 1. `src/main/extension-api.ts`<br>2. `src/main/extension-registry.ts` (扩展安装后上报) | 是 (安装计数统计) | 是 | - 彻底删除此函数定义及在 `extension-registry.ts` 中的调用 |
| **reportUninstall** | 1. `src/main/extension-api.ts`<br>2. `src/main/extension-registry.ts` (扩展卸载后上报) | 是 (卸载计数统计) | 是 | - 彻底删除此函数定义及在 `extension-registry.ts` 中的调用 |
| **electron-updater** | `src/main/main.ts` (`autoUpdater` 实例化、FeedURL 配置与更新检查) | 是 (发布检查) | 否 (开源依赖，原配置指向官方) | - 保留 `electron-updater` 库能力，重定向 Feed 配置至 `MdicaL7/SuperCmd`<br>- 增加拦截断言，绝不向 SuperCmdLabs 发起请求 |
| **publish** | `package.json` (`build.publish`) | 是 (构建发布目标) | 是 (原指向 SuperCmdLabs) | - 修改为：`provider: "github", owner: "MdicaL7", repo: "SuperCmd", releaseType: "release"` |
| **setFeedURL** | `src/main/main.ts` (`appUpdater.setFeedURL(feedConfig)`) | 是 | 否 (Updater 方法) | - 保留方法调用，确保其接收的 feedConfig 指向用户自有仓库 |
| **homepage** | `package.json` (`"homepage": "https://supercmd.sh"`) | 是 (元数据字段) | 是 | - 直接从 `package.json` 中删除该字段 |
| **repository** | `package.json` (`"repository": "https://github.com/SuperCmdLabs/SuperCmd"`) | 是 (元数据字段) | 是 | - 修改为当前仓库：`"https://github.com/MdicaL7/SuperCmd"` |
| **supercmd://** | 1. `src/main/main.ts` (协议注册与 URL 处理)<br>2. `src/main/commands.ts` (命令 deeplink 生成)<br>3. `src/renderer` (Notes、Canvas、OAuth callback URL 生成) | 否 (系统 URL Scheme) | 混合 (原品牌 Scheme) | - 新增 `wudi://` 作为第一主协议<br>- 保持对 `supercmd://` 的别名兼容解析，避免已有 OAuth 回调、便签链接及外部调用失效 |

---

## 结论与改造前置确认

1. **核心剔除项**：
   - 依赖包 `@aptabase/electron` 及 App Key `A-US-7660732429`
   - 文件 `src/main/extension-api.ts`
   - 官方域名请求：`api.supercmd.sh`, `supercmd.sh`, `SuperCmdLabs`
   - 官方发布与签名：`Shobhit Bhosure`, `T7HT4U4666`

2. **核心保留项**：
   - 第三方 AI 服务、Supermemory、Raycast GitHub 扩展获取能力、本地 Browser tabs 桥接
   - 内部兼容机制与协议别名（`supercmd://` 向后兼容，内部 `sc-asset://` 与 `sc-clipboard://` 保持不变）
   - 原开源项目的 LICENSE 署名
