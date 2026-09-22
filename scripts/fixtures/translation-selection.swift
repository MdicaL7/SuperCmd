import Foundation

typealias CFString = String
let kAXFocusedUIElementAttribute = "AXFocusedUIElement"
let kAXRoleAttribute = "AXRole"
let kAXChildrenAttribute = "AXChildren"

final class AXUIElement {
  let name: String
  let role: String
  var text: String?
  var focused: AXUIElement?
  var children: [AXUIElement]
  init(_ name: String, role: String = "AXTextField", text: String? = nil, focused: AXUIElement? = nil, children: [AXUIElement] = []) {
    self.name = name; self.role = role; self.text = text; self.focused = focused; self.children = children
  }
}
var readNodes: [String] = []
func CFEqual(_ lhs: AXUIElement, _ rhs: AXUIElement) -> Bool { lhs === rhs }
func copyAttribute(_ node: AXUIElement, _ attribute: CFString) -> AnyObject? {
  switch attribute {
  case kAXFocusedUIElementAttribute: return node.focused
  case kAXRoleAttribute: return node.role as NSString
  case kAXChildrenAttribute: return node.children as NSArray
  default: return nil
  }
}
func axElementFromRaw(_ raw: AnyObject?) -> AXUIElement? { raw as? AXUIElement }
func selectedTextFromElement(_ node: AXUIElement) -> String? { readNodes.append(node.name); return node.text }

// The runner inserts the unchanged strictFocusedSelection function here.
// INSERT_POLICY

func check(_ name: String, _ root: AXUIElement, expected: String?, reads: [String]) {
  readNodes = []
  precondition(strictFocusedSelection(root) == expected, name)
  precondition(readNodes == reads, "\(name): read unrelated node \(readNodes)")
}
let stale = AXUIElement("stale", text: "old selection")
let field = AXUIElement("current-field")
check("empty focus cannot search siblings", field, expected: nil, reads: ["current-field"])
check("container cannot search arbitrary children", AXUIElement("group", role: "AXGroup", children: [field, stale]), expected: nil, reads: ["group"])
check("explicit child focus beats stale document", AXUIElement("document", role: "AXWebArea", text: "old page selection", focused: field, children: [stale]), expected: nil, reads: ["current-field"])
check("current browser selection", AXUIElement("web", role: "AXWebArea", text: "browser selection", children: [stale]), expected: "browser selection", reads: ["web"])
let pdf = AXUIElement("pdf", role: "AXPDFDocument", text: "PDF selection", children: [stale])
check("focused PDF scroll wrapper", AXUIElement("scroll", role: "AXScrollArea", children: [pdf, stale]), expected: "PDF selection", reads: ["scroll", "pdf"])
check("ambiguous documents return empty", AXUIElement("split", role: "AXScrollArea", children: [pdf, AXUIElement("other", role: "AXDocument", text: "old")]), expected: nil, reads: ["split"])
check("document descendants are not scanned", AXUIElement("empty-web", role: "AXWebArea", children: [stale]), expected: nil, reads: ["empty-web"])
let cycle = AXUIElement("cycle"); cycle.focused = cycle
check("focus cycle terminates", cycle, expected: nil, reads: ["cycle"])
print("8 strict focus selection cases passed")
