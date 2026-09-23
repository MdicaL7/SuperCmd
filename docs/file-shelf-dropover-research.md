# Dropover macOS Interaction Research & SuperCmd File Shelf Specification

## 1. Executive Summary

This research investigates the real-world interaction patterns, gestures, visual structures, and system mechanics of **Dropover** (by Damir Tursunovic, Mac App Store ID: 1355679052) across macOS Ventura, Sonoma, and Sequoia.

The objective is to replace SuperCmd's current "mini file manager" paradigm (fixed 440×540 window, permanent buttons, checkboxes, search bars, and status footers) with an agile, gesture-activated **temporary floating shelf** optimized for high-frequency drag-and-drop file staging.

---

## 2. Dropover Real-World Interaction Analysis

### A. Shelf Triggering & Gesture Detection
- **Trigger Scenario**: The user starts dragging one or more files in Finder, Mail, Chrome, or any other macOS application (mouse button down, cursor moving). While maintaining the drag, the user vigorously shakes the mouse pointer back and forth horizontally.
- **Gesture Feel**: A rapid 3–4 direction reversal within ~400–600ms. It feels identical to the macOS "shake mouse pointer to locate" system gesture, but executed specifically while `leftMouseDragged` is active.
- **Positioning**: The temporary drop zone appears immediately **at or adjacent to the cursor location**, slightly offset so the cursor hovers directly over the drop receptacle without blocking the drop target visual center.
- **Initial Visual Form**: Dropover shows a compact floating receptacle with a dashed or vibrant glowing border prompting "Drop here".
- **Unbroken Drag Session**: The user **must keep holding the mouse button**. The system drag session initiated in Finder is continuous and uninterrupted.
- **Zero Focus Stealing**: Dropover explicitly displays its window using `showInactive` / `orderFrontRegardless` (`NSWindowCollectionBehaviorTransient` / floating level). It **never becomes the key window or steals keyboard focus during the drag**, because focusing would immediately terminate the Finder drag session.

### B. Post-Drop Transformation (Morphing)
- **Drop Action**: The user releases the left mouse button while over the target. Finder commits the drop.
- **Visual Transformation**: The drop target smoothly morphs into an active Shelf displaying the staged files.
- **Content-Driven Compact Layout**:
  - **1 file**: A compact card (~260×90px) showing the system file icon, clean truncated name, and file size/kind.
  - **2–4 files**: A horizontal row or compact 2-column grid (~340×140px) displaying file thumbnails and short labels.
  - **5+ files**: A compact grid with scroll or a compact stack badge showing the first items and a count badge (`+N`).
  - The shelf never expands to an oversized 440×540 document window. The maximum size stays bounded around ~420×220px.
- **Dismissal on Cancel**: If the user summons the drop target via shake but releases the mouse outside, presses Esc, or drags away without dropping, the target automatically dismisses itself.
- **Window Behavior**: Once populated, the Shelf floats above standard application windows (`alwaysOnTop`), remaining visible even when other apps are blurred or clicked, until the user dismisses it or drags items out.

### C. Dragging Out & File Handoff
- **Single File Drag Out**: The user clicks directly on any file card/icon and drags it into a Finder window, desktop, chat app (Slack, WeChat, Telegram), browser file uploader, or email composer.
- **Multi-Selection**:
  - Uses standard macOS selection: `⌘ + click` (Cmd-click) toggles multi-selection of items.
  - Dragging any selected item starts an external drag containing **all** currently selected items.
  - Dragging an unselected item drags only that item.
  - No checkboxes are shown.
- **Shelf Lifecycle After Drag Out**:
  - In Dropover: By default, dragging all items out closes the shelf automatically (unless pinned or Shift is held).
  - In SuperCmd: Because SuperCmd operates as a reference-only clipboard and toolbox utility, dragging items out uses `NSDragOperationCopy` (leaving source files untouched). The shelf can close when empty or via explicit close (`×` button / `Esc`), preventing accidental loss of staging context.

### D. Secondary Actions & Progressive Disclosure
Dropover avoids visible toolbars and button walls by strictly adhering to progressive disclosure:
- **No permanent action buttons**: No `Add Files`, `Add Folder`, `Copy`, `Select All`, or `Clear` buttons cluttering the view.
- **Native Context Menu (Right Click)**:
  - **On an item**:
    - Show in Finder (`reveal`)
    - Copy File References (`⌘C`)
    - Remove from Shelf (`Delete`)
  - **On shelf background / empty area**:
    - Add Files...
    - Add Folder...
    - Clear Shelf
    - Always on Top (Toggle)
    - Shake to Activate (Toggle)
    - Hide Shelf (`Esc`)
- **Keyboard Shortcuts** (when shelf is active):
  - `⌘C`: Copy selected file references into clipboard (`NSURL` pasteboard items).
  - `Delete` / `Backspace`: Remove selected items from shelf (never deleting disk sources).
  - `⌘A`: Select all staged files.
  - `Esc` / `⌘W`: Close / hide shelf.
- **Subtle Close Control**: A minimal `×` button in the top corner (revealed on hover or always subtle) allows instant one-click dismissal.

### E. Visual Hierarchy & Design Language
- **Window Shape**: Smooth rounded rectangle (`border-radius: 14px–16px`).
- **Surface**: macOS vibrancy / glassmorphism (`backdrop-filter: blur(24px)` with semi-transparent background: light `#f7f8faee`, dark `#1e2026ee`).
- **Border**: Subtle 1px translucent border (`rgba(255,255,255,0.12)` in dark mode, `rgba(0,0,0,0.08)` in light mode).
- **Shadow**: Deep macOS floating shadow (`box-shadow: 0 16px 36px rgba(0,0,0,0.3)`).
- **Drag-Over Feedback**: Subtle glowing accent outline (`#3b82f6`) with gentle scale feedback.

---

## 3. Comparison: Dropover vs. Current SuperCmd vs. Target SuperCmd

| Aspect | Dropover | Current SuperCmd File Shelf | SuperCmd File Shelf (Target Specification) |
| :--- | :--- | :--- | :--- |
| **Summoning Gesture** | Shake mouse during file drag | None (must open via Launcher/Command) | **Shake mouse during file drag** (or Launcher toggle) |
| **Initial Appearance** | Lightweight Drop Target at mouse cursor | Heavy 440×540 window with toolbar | **Compact Drop Target at mouse cursor** (180×130) |
| **Focus Handling** | Zero focus theft (`showInactive`) | Creates/focuses window (breaks Finder drag) | **Zero focus theft** (`showInactive`, `acceptFirstMouse`) |
| **Post-Drop Layout** | Compact content-driven shelf | Large file list with search and paths | **Compact grid/pill shelf** (max ~420×220) |
| **Item Selection** | Click / `⌘+click` (no checkboxes) | HTML checkboxes + select-all bar | **Click / `⌘+click`** (no checkboxes) |
| **Secondary Controls** | Context menu + keyboard shortcuts | Permanent button wall (Add, Folder, Copy, Clear) | **Native context menu + keyboard shortcuts** |
| **Source File Safety** | Reference-only (optional move) | Reference-only (`NSDragOperationCopy`) | **Reference-only (`NSDragOperationCopy`)** |
| **Window Level** | Floating (`alwaysOnTop`) | Floating (`alwaysOnTop`) | **Floating (`alwaysOnTop`)** |
| **Reopening on Launch** | Stays hidden or pinned | Restores window bounds, opens on command | **Restores references; stays hidden on launch** |

---

## 4. What Behaviors Fit SuperCmd vs. What We Omit

### Adopted for SuperCmd
1. **Shake Gesture Activation**: Native Swift helper monitoring mouse drag trajectory, checking `NSPasteboard(name: .drag)` for file URLs, triggering drop target near cursor without interrupting Finder drag.
2. **Dual-State Presentation**:
   - State 1: **Drop Target** (`~180×130`): Clean glowing drop zone near cursor.
   - State 2: **Compact Shelf** (`~300–420 × 120–200`): Compact item tray showing icon + short name + badge.
3. **Seamless Drag-Out**: Directly drag any item or multi-selection (`⌘+click`) to Finder or third-party apps.
4. **Progressive Disclosure**: Remove all primary buttons; retain actions in context menu and keyboard shortcuts (`⌘C`, `Delete`, `Esc`, `⌘A`).
5. **Multi-Display & Coordinate Clamping**: Clamped to the active display's `workArea`, supporting negative coordinates and Retina displays.

### Explicitly Excluded (Out of Scope for This Iteration)
1. **Dropover Cloud / Web Upload**: SuperCmd is a local-first utility.
2. **Drop to MacBook Notch**: Highly model-dependent and redundant when shake gesture is present.
3. **Multiple Concurrent Shelves**: Creates desktop clutter; a single unified, compact shelf provides clearer state for SuperCmd.
4. **Instant Action Extensions (OCR, image resizing, zip)**: SuperCmd already has dedicated screenshot OCR and translation features.

---

## 5. Research Sources & Citations

1. Dropover Official Website: https://dropoverapp.com
2. Dropover Frequently Asked Questions: https://dropoverapp.com/faq
3. Dropover Tips & Guides: https://dropoverapp.com/tips
4. Dropover Keyboard Shortcuts Documentation: https://dropoverapp.com/kb/shelf-keyboard-shortcuts
5. Mac App Store Dropover Entry: https://apps.apple.com/app/dropover-easier-drag-drop/id1355679052
6. Daring Fireball Dropover Review: https://daringfireball.net
7. Lifehacker Dropover Mac Utility Guide: https://lifehacker.com
8. Apple Developer Documentation: `NSPasteboard.Name.drag`, `CGEvent.tapCreate`, `NSWindow.orderFrontRegardless`.
