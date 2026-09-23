# WUDI Brand String & Legacy Compatibility Audit

## Executive Summary
This document provides a complete inventory of all occurrences of the term `SuperCmd` across the codebase following the rebrand to **WUDI**, detailing the architectural justification for every retained occurrence.

---

## 1. Primary Rebranded Identifiers

| Layer | Value | Location |
| :--- | :--- | :--- |
| **Product Name** | `WUDI` | `src/shared/brand.ts`, `package.json`, `main.ts` |
| **App Bundle ID** | `com.mdical7.wudi` | `src/shared/brand.ts`, `package.json`, `notarize.js` |
| **Primary Protocol** | `wudi://` | `src/shared/brand.ts`, `package.json`, `commands.ts`, `misc-runtime.ts` |
| **User Agent** | `WUDI (com.mdical7.wudi)` | `src/main/extension-registry.ts` |
| **Menu Bar Title & Tray** | `WUDI` | `src/main/main.ts`, `assets/wudi/菜单栏.png` |
| **Application Icons** | `wudi.icns`, `wudi.png` | `assets/wudi/icon1.png`, `wudi.icns`, `package.json` |
| **Window Title** | `WUDI` | `src/renderer/index.html` |
| **User Interface Labels** | `WUDI Settings`, `WUDI AI`, `WUDI Whisper`, `WUDI Read`, `WUDI Extensions`, `WUDI Onboarding` | `commands.ts`, `locales/*.json`, `OnboardingExtension.tsx`, `AiChatView.tsx`, `ExtensionsTab.tsx` |

---

## 2. Inventory of Retained `SuperCmd` References & Rationale

| Category | Files | Rationale |
| :--- | :--- | :--- |
| **Protocol Compatibility Alias** | `package.json`, `src/main/main.ts`, `src/shared/brand.ts`, `src/renderer/src/raycast-api/oauth/oauth-bridge.ts` | Registers and intercepts `supercmd://` protocol URIs (e.g. `supercmd://extensions/...`, `supercmd://oauth/callback`). Ensures existing shortcuts, bookmarks, and external extension scripts continue to function without breaking user data. |
| **Window & Process Protection** | `src/main/main.ts`, `src/main/auto-quit-manager.ts`, `src/main/window-manager-worker.ts`, `src/renderer/src/WindowManagerPanel.tsx` | Window and process exclusion lists check both `WUDI` and legacy `supercmd` identifiers to ensure the launcher window, floating shelf, and whisper overlays never tile, minimize, or auto-quit themselves. |
| **Search Keywords (Muscle Memory)** | `src/main/commands.ts` | Command keywords include both `wudi` and `supercmd` so existing users searching for familiar terms immediately find the appropriate system commands. |
| **i18n Translation Key Stability** | `src/renderer/src/i18n/locales/*.json`, `src/renderer/src/settings/ExtensionsTab.tsx` | Preserves the internal JSON key `settings.extensions.builtIn.superCmd` while displaying user-visible string `"title": "WUDI"` and `"description": "Built-in WUDI commands"`. Prevents breaking TypeScript types and localization structures. |
| **User Data Migration** | `src/main/user-data-migration.ts`, `src/main/main.ts` | Checks legacy `~/Library/Application Support/SuperCmd` directory to seamlessly and non-destructively migrate existing user settings, notes, canvas files, extensions, and clipboard history on first launch into `WUDI`. |
| **Git & Upstream Attribution** | `LICENSE`, `package.json` (`repository`), documentation | Preserves upstream open-source license attribution to the original author Shobhit Bhosure per ISC license requirements, and points the repository URL to `https://github.com/MdicaL7/WUDI`. |
| **Migration & Historical Docs** | `docs/wudi-*.md`, `docs/dev-notes/*`, `CLAUDE.md` | Documents the de-officialization migration, architectural boundaries, and protocol compatibility guarantees. |
