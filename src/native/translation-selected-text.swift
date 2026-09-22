import Foundation
import ApplicationServices
import AppKit

private let debugEnabled = ProcessInfo.processInfo.environment["TRANSLATION_SELECTED_TEXT_DEBUG"] == "1"

private func dbg(_ message: @autoclosure () -> String) {
  if debugEnabled {
    FileHandle.standardError.write(Data(("[translation-selected-text] " + message() + "\n").utf8))
  }
}

private func writeAndExit(_ text: String) -> Never {
  if !text.isEmpty {
    FileHandle.standardOutput.write(Data(text.utf8))
  }
  exit(0)
}

private func copyAttribute(_ element: AXUIElement, _ attribute: CFString) -> AnyObject? {
  var raw: AnyObject?
  let err = AXUIElementCopyAttributeValue(element, attribute, &raw)
  if err != .success {
    dbg("attribute \(attribute) err=\(err.rawValue)")
    return nil
  }
  return raw
}

private func copyParameterizedAttribute(_ element: AXUIElement, _ attribute: CFString, _ parameter: AnyObject) -> AnyObject? {
  var raw: AnyObject?
  let err = AXUIElementCopyParameterizedAttributeValue(element, attribute, parameter, &raw)
  if err != .success {
    dbg("parameterized \(attribute) err=\(err.rawValue)")
    return nil
  }
  return raw
}

private func stringFromAXResult(_ raw: AnyObject?) -> String? {
  guard let raw else { return nil }
  if let text = raw as? String { return text.isEmpty ? nil : text }
  if let attributed = raw as? NSAttributedString {
    let text = attributed.string
    return text.isEmpty ? nil : text
  }
  if CFGetTypeID(raw) == CFAttributedStringGetTypeID() {
    let attributed = raw as! NSAttributedString
    let text = attributed.string
    return text.isEmpty ? nil : text
  }
  return nil
}

private func selectedRangeValue(_ element: AXUIElement) -> AnyObject? {
  guard let rangeValue = copyAttribute(element, kAXSelectedTextRangeAttribute as CFString) else {
    return nil
  }
  var range = CFRange(location: 0, length: 0)
  guard AXValueGetValue(rangeValue as! AXValue, .cfRange, &range), range.length > 0 else {
    return nil
  }
  return rangeValue
}

private func selectedTextViaValueRange(_ element: AXUIElement, _ rangeValue: AnyObject) -> String? {
  guard let fullText = copyAttribute(element, kAXValueAttribute as CFString) as? String else {
    return nil
  }
  var range = CFRange(location: 0, length: 0)
  guard AXValueGetValue(rangeValue as! AXValue, .cfRange, &range), range.length > 0 else {
    return nil
  }

  // CFRange from AX text controls is expressed in UTF-16 offsets.
  let utf16 = fullText.utf16
  guard let startIdx = utf16.index(utf16.startIndex, offsetBy: range.location, limitedBy: utf16.endIndex),
        let endIdx = utf16.index(startIdx, offsetBy: range.length, limitedBy: utf16.endIndex),
        let slice = String(utf16[startIdx..<endIdx]),
        !slice.isEmpty else {
    return nil
  }
  return slice
}

private func selectedTextViaRangeParameterizedAttribute(_ element: AXUIElement, _ rangeValue: AnyObject) -> String? {
  let attributes: [CFString] = [
    kAXStringForRangeParameterizedAttribute as CFString,
    kAXAttributedStringForRangeParameterizedAttribute as CFString,
    "AXStringForRange" as CFString,
    "AXAttributedStringForRange" as CFString,
  ]
  for attribute in attributes {
    if let text = stringFromAXResult(copyParameterizedAttribute(element, attribute, rangeValue)) {
      return text
    }
  }
  return nil
}

private func selectedTextViaTextMarkerRange(_ element: AXUIElement) -> String? {
  guard let markerRange = copyAttribute(element, "AXSelectedTextMarkerRange" as CFString) else {
    return nil
  }

  let attributes: [CFString] = [
    "AXStringForTextMarkerRange" as CFString,
    "AXAttributedStringForTextMarkerRange" as CFString,
  ]
  for attribute in attributes {
    if let text = stringFromAXResult(copyParameterizedAttribute(element, attribute, markerRange)) {
      return text
    }
  }
  return nil
}

private func selectedTextFromElement(_ element: AXUIElement) -> String? {
  let role = copyAttribute(element, kAXRoleAttribute as CFString) as? String ?? ""
  let subrole = copyAttribute(element, kAXSubroleAttribute as CFString) as? String ?? ""
  if role == "AXSecureTextField" || subrole == (kAXSecureTextFieldSubrole as String) {
    return nil
  }

  if let text = stringFromAXResult(copyAttribute(element, kAXSelectedTextAttribute as CFString)) {
    return text
  }
  if let text = selectedTextViaTextMarkerRange(element) {
    return text
  }
  if let rangeValue = selectedRangeValue(element) {
    if let text = selectedTextViaRangeParameterizedAttribute(element, rangeValue) {
      return text
    }
    if let text = selectedTextViaValueRange(element, rangeValue) {
      return text
    }
  }
  return nil
}

private func axElementFromRaw(_ raw: AnyObject?) -> AXUIElement? {
  guard let raw, CFGetTypeID(raw) == AXUIElementGetTypeID() else {
    return nil
  }
  return (raw as! AXUIElement)
}

// Translation deliberately does not search a window or arbitrary descendants.
// A non-focused field can retain AXSelectedText long after the user leaves it.
private func currentFocusedElement(app: AXUIElement, pid: pid_t) -> AXUIElement? {
  let system = AXUIElementCreateSystemWide()
  if let focused = axElementFromRaw(copyAttribute(system, kAXFocusedUIElementAttribute as CFString)) {
    var focusedPID: pid_t = 0
    if AXUIElementGetPid(focused, &focusedPID) == .success, focusedPID == pid {
      return focused
    }
  }
  return axElementFromRaw(copyAttribute(app, kAXFocusedUIElementAttribute as CFString))
}

private func strictFocusedSelection(_ root: AXUIElement) -> String? {
  var focused = root
  var visited: [AXUIElement] = [root]
  // Some document wrappers expose a more specific focus. Prefer the deepest
  // explicit focus so a parent document's old selection cannot beat a field.
  for _ in 0..<12 {
    guard let child = axElementFromRaw(copyAttribute(focused, kAXFocusedUIElementAttribute as CFString)),
          !visited.contains(where: { CFEqual($0, child) }) else { break }
    visited.append(child)
    focused = child
  }
  if let text = selectedTextFromElement(focused) { return text }

  // PDF viewers may focus a scroll area wrapping one document. Restrict this
  // fallback to that document node itself; never scan its controls or pages.
  let role = copyAttribute(focused, kAXRoleAttribute as CFString) as? String ?? ""
  guard role == "AXScrollArea" else { return nil }
  guard let children = copyAttribute(focused, kAXChildrenAttribute as CFString) as? [AXUIElement] else { return nil }
  let documents = children.filter {
    let role = copyAttribute($0, kAXRoleAttribute as CFString) as? String ?? ""
    return ["AXWebArea", "AXDocument", "AXPDFDocument"].contains(role)
  }
  guard documents.count == 1 else { return nil }
  return selectedTextFromElement(documents[0])
}

// Do not prompt or synthesize Copy. Missing access is a normal empty selection.
guard AXIsProcessTrusted(), let frontApp = NSWorkspace.shared.frontmostApplication else { writeAndExit("") }
let pid = frontApp.processIdentifier
let appElement = AXUIElementCreateApplication(pid)
// Chromium/Electron expose text-marker ranges after these AX opt-in flags.
AXUIElementSetAttributeValue(appElement, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
AXUIElementSetAttributeValue(appElement, "AXManualAccessibility" as CFString, kCFBooleanTrue)
var focused = currentFocusedElement(app: appElement, pid: pid)
if focused == nil {
  Thread.sleep(forTimeInterval: 0.06)
  focused = currentFocusedElement(app: appElement, pid: pid)
}
guard let focused else { writeAndExit("") }
let text = strictFocusedSelection(focused) ?? ""
// If focus or application changed during AX calls, discard the old selection.
guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
      let finalFocus = currentFocusedElement(app: appElement, pid: pid),
      CFEqual(focused, finalFocus) else { writeAndExit("") }
writeAndExit(text)
