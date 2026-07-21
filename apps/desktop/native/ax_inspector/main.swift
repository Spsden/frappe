// ax_inspector — macOS accessibility element-at-point probe (Phase 2).
//
// Given global screen coordinates (points, the same space uiohook reports),
// returns the UI element under the cursor as JSON on stdout:
//   { "role": "AXButton", "subrole": null, "label": "Save",
//     "isSecure": false, "value": null,
//     "frame": { "x": 100, "y": 200, "width": 80, "height": 28 } }
//
// `frame` is the element's AXFrame in GLOBAL SCREEN POINTS (not pixels). The
// caller converts it to screenshot-pixel space via the display bounds + scale
// factor. `value` is omitted (null) for secure fields so passwords are never
// read. Emits `null` when AX is disabled or no element is hit.
//
// Build: see build.sh
// Usage: ax_inspector <x> <y>

import ApplicationServices
import Foundation

func readStringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: CFTypeRef?
    guard
        AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
        let result = value as? String
    else { return nil }
    return result
}

func readRect(_ element: AXUIElement) -> [String: Double]? {
    var positionValue: CFTypeRef?
    var sizeValue: CFTypeRef?
    guard
        AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionValue) == .success,
        AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue) == .success
    else { return nil }

    guard let positionRef = positionValue, let sizeRef = sizeValue else { return nil }

    var point = CGPoint.zero
    var size = CGSize.zero
    guard
        AXValueGetValue(positionRef as! AXValue, .cgPoint, &point),
        AXValueGetValue(sizeRef as! AXValue, .cgSize, &size)
    else { return nil }

    return [
        "x": Double(point.x),
        "y": Double(point.y),
        "width": Double(size.width),
        "height": Double(size.height)
    ]
}

func box(_ value: String?) -> Any {
    value ?? NSNull()
}

let arguments = CommandLine.arguments
guard arguments.count >= 3,
      let x = Double(arguments[1]),
      let y = Double(arguments[2])
else {
    FileHandle.standardError.write(Data("usage: ax_inspector <x> <y>\n".utf8))
    exit(2)
}

let systemWide = AXUIElementCreateSystemWide()
var element: AXUIElement?
let result = AXUIElementCopyElementAtPosition(systemWide, Float(x), Float(y), &element)

guard result == .success, let hit = element else {
    // AX disabled, no element under the point, or out of bounds.
    FileHandle.standardOutput.write(Data("null".utf8))
    exit(0)
}

let role = readStringAttribute(hit, kAXRoleAttribute)
let subrole = readStringAttribute(hit, kAXSubroleAttribute)
let title = readStringAttribute(hit, kAXTitleAttribute)
let description = readStringAttribute(hit, kAXDescriptionAttribute)
let value = readStringAttribute(hit, kAXValueAttribute)
let frame = readRect(hit)

let isSecure = (subrole?.contains("Secure") ?? false) || (role?.contains("Secure") ?? false)
let label = title ?? description ?? ""

var payload: [String: Any] = [
    "role": box(role),
    "subrole": box(subrole),
    "label": label,
    "isSecure": isSecure,
    "value": isSecure ? NSNull() : box(value),
    "frame": frame ?? NSNull()
]

let data = try! JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(data)
