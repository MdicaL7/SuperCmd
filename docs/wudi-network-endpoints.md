# WUDI Network Endpoints Audit

## Executive Summary
This document provides a comprehensive audit of all network endpoints, telemetry targets, and remote service integrations present in the WUDI codebase following the de-officialization refactor.

**Zero official SuperCmd backend services, telemetry services, or reporting targets remain active.**

---

## 1. Removed Official Endpoints & Telemetry Targets

| Removed Target | Prior Usage | Current Status |
| :--- | :--- | :--- |
| `https://api.supercmd.sh/*` | Official backend for extensions catalog, popular extensions, extension details, downloads, and OAuth relay | **Completely Removed**. `src/main/extension-api.ts` deleted. Extension registry now resolves directly against GitHub Raycast catalog. |
| `https://api.aptabase.com` (`A-US-7660732429`) | Aptabase analytics & telemetry SDK (`@aptabase/electron`) tracking app startup and events | **Completely Removed**. Package dependency uninstalled, initialization and event tracking stripped from `main.ts`. |
| `SuperCmdLabs/*` | GitHub updater feed repository owner | **Strictly Rejected**. `src/main/updater-config.ts` prevents any connection to `SuperCmdLabs`. Only `MdicaL7/SuperCmd` is permitted. |
| `.machine-id` telemetry report | Reporting anonymous hardware machine ID during extension install / uninstall | **Completely Removed**. Extension install/uninstall no longer posts telemetry or creates hardware IDs. |
| `https://supercmd.sh` | Official website listed as `homepage` in `package.json` | **Removed**. `package.json` repository points to `https://github.com/MdicaL7/SuperCmd`. |
| `https://supercmd-extensions.s3.amazonaws.com` | Remote S3 bucket for Canvas Excalidraw bundle | **Replaced with Local Bundle**. Canvas now unpacks the offline bundle bundled in `canvas-app/excalidraw-bundle.tgz`. |

---

## 2. Retained Third-Party & Local Services

All remaining endpoints represent standard, user-configured third-party integrations, public open-source registries, or local loopback bridges:

### A. Raycast Extension Store & GitHub
- `https://api.github.com/repos/raycast/extensions/contents`
- `https://api.github.com/repos/raycast/extensions/git/trees/main?recursive=1`
- `https://raw.githubusercontent.com/raycast/extensions/main`
- `https://github.com/raycast/extensions`
  * **Purpose**: Fetches the open Raycast community extensions catalog and icons directly from GitHub without any intermediary proxy.

### B. AI & LLM Providers
- `https://api.openai.com/v1` (OpenAI API)
- `https://api.openrouter.ai/v1` (OpenRouter API)
- `https://api.supermemory.ai` (Supermemory knowledge integration)
- `http://127.0.0.1:11434` (Ollama local inference)
- `http://localhost:1234` (LM Studio local inference)
  * **Purpose**: Direct user-configured AI model completions and embeddings.

### C. Voice & Audio
- `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list` (Edge TTS)
- ElevenLabs API
- `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-` (Local Whisper model weights)
- `https://github.com/ggml-org/whisper.cpp/releases/download/` (Whisper cpp prebuilt binaries)
  * **Purpose**: Offline and user-configured voice dictation and speech synthesis.

### D. Search Engines & Web Bangs
- `https://duckduckgo.com`
- `https://www.google.com`, `https://suggestqueries.google.com`
- `https://raw.githubusercontent.com/T3-Content/unduck/main/src/bang.ts`
  * **Purpose**: Web search completions and DuckDuckGo / Google search navigation.

### E. OAuth Providers (Standard User Extension Flows)
- Google (`accounts.google.com`, `oauth2.googleapis.com`)
- Spotify (`accounts.spotify.com`)
- Slack (`slack.com`)
- Asana (`app.asana.com`)
- Atlassian (`auth.atlassian.com`)
- Linear (`linear.app`)
- Zoom (`zoom.us`)
  * **Purpose**: Standard PKCE OAuth flows initiated by specific community extensions. Callbacks route to `wudi://oauth/callback` (with legacy fallback to `supercmd://oauth/callback`).

### F. Local IPC & Native Bridges
- `http://127.0.0.1:17373` (WUDI Browser Extension local WebSocket/HTTP server bridge for active tabs)
- `http://127.0.0.1`, `http://localhost` (Local system daemons)
