// mouse click X Y | mouse drag X1 Y1 X2 Y2 | mouse scroll X Y DY  (Bildschirmkoordinaten in Punkten)
import CoreGraphics
import Foundation
let a = CommandLine.arguments
func post(_ type: CGEventType, _ p: CGPoint) {
  CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(30_000)
}
let n = a.dropFirst(2).compactMap { Double($0) }
switch a[1] {
case "click":
  let p = CGPoint(x: n[0], y: n[1]); post(.mouseMoved, p); post(.leftMouseDown, p); post(.leftMouseUp, p)
case "drag":
  let p1 = CGPoint(x: n[0], y: n[1]), p2 = CGPoint(x: n[2], y: n[3])
  post(.mouseMoved, p1); post(.leftMouseDown, p1)
  for i in 1...20 { post(.leftMouseDragged, CGPoint(x: p1.x + (p2.x - p1.x) * Double(i) / 20, y: p1.y + (p2.y - p1.y) * Double(i) / 20)) }
  post(.leftMouseUp, p2)
case "scroll":
  post(.mouseMoved, CGPoint(x: n[0], y: n[1]))
  CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32(n[2]), wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
default: break
}
