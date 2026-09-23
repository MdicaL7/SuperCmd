# WUDI 协议迁移与兼容性规范 (Protocol Migration & Compatibility)

## 1. 协议策略概览

在去官方化过程中，URL Scheme 是系统级外部调用的核心入口。为确保品牌去官方化同时不破坏存量数据、OAuth 回调以及外部脚本集成，采用 **双协议注册 + 双向兼容** 策略：

- **主协议 (Primary Scheme)**: `wudi://`
- **兼容协议 (Legacy Compatibility Alias)**: `supercmd://`
- **Raycast 兼容协议 (Raycast Interop)**: `raycast://` (仅用于扩展及脚本命令)

---

## 2. 协议路由清单与映射表

| 目标功能 | 新主协议 URL 格式 (`wudi://`) | 兼容协议 URL 格式 (`supercmd://`) | 处理行为 |
| :--- | :--- | :--- | :--- |
| **便签深度链接** | `wudi://notes/<note-id>` | `supercmd://notes/<note-id>` | 打开 Notes 窗口并定位至指定便签 |
| **画板深度链接** | `wudi://canvas/<canvas-id>` | `supercmd://canvas/<canvas-id>` | 打开 Canvas 窗口并加载指定画板 |
| **扩展命令启动** | `wudi://extensions/<owner>/<ext>/<cmd>` | `supercmd://extensions/...` | 解析扩展参数并拉起对应命令 |
| **脚本命令启动** | `wudi://script-commands/<slug>` | `supercmd://script-commands/...` | 执行本地匹配的脚本命令 |
| **通用命令 ID** | `wudi://commands/<command-id>` | `supercmd://commands/<command-id>` | 激活启动器并执行指定命令 |
| **OAuth 授权回调** | `wudi://oauth/callback` | `supercmd://oauth/callback` | 接收 OAuth provider 的授权 code/token 并派发给对应扩展 |

---

## 3. 为什么必须暂时保留 `supercmd://` 兼容别名

1. **OAuth 回调服务稳定性**：许多第三方 OAuth Provider（如 GitHub、Google 等）的回调地址预先注册在应用设置或本地配置中。立即废弃将直接导致尚未更新配置的扩展授权失败。
2. **已有持久化便签与画板链接**：用户可能已将便签链接或画板链接拷贝至系统剪贴板、第三方笔记（Notion、Obsidian 等）或浏览器书签中。保持别名解析可确保这些历史链接点击后仍能无缝唤起 WUDI。
3. **Raycast 社区扩展生态互通**：部分 Raycast 社区扩展生成的内部链接或相互跳转可能包含特定的 URL 模式，保持别名解析保证了扩展运行时生命周期不受影响。

---

## 4. 内部专用协议隔离说明

以下协议属于 Electron 内部私有特权协议，**不属于外部公开品牌 URL Scheme**，保持内部契约稳定：
- `sc-asset://`: 用于安全加载本地扩展资源文件与画板离线静态资源（具备 bypassCSP 权限）。
- `sc-clipboard://`: 用于在渲染进程中安全显示本地剪贴板历史图片。
- 这两个协议不暴露给操作系统外部，不涉及用户可见品牌，不对外作为 URL Scheme 注册。
