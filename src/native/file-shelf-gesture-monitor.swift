import Foundation
import AppKit
import CoreGraphics

// MARK: - Core Shake Detection Logic (Decoupled & Deterministically Testable)

public struct PointSample {
    public let x: Double
    public let y: Double
    public let timestamp: Double

    public init(x: Double, y: Double, timestamp: Double) {
        self.x = x
        self.y = y
        self.timestamp = timestamp
    }
}

public final class ShakeDetector {
    public var windowDuration: Double
    public var minReversals: Int
    public var minSegmentDx: Double
    public var minTotalDistance: Double
    public var maxNetDisplacement: Double
    public var cooldownDuration: Double

    private var samples: [PointSample] = []
    private var lastTriggerTime: Double = -100.0

    public init(
        windowDuration: Double = 0.55,
        minReversals: Int = 3,
        minSegmentDx: Double = 20.0,
        minTotalDistance: Double = 90.0,
        maxNetDisplacement: Double = 100.0,
        cooldownDuration: Double = 1.2
    ) {
        self.windowDuration = windowDuration
        self.minReversals = minReversals
        self.minSegmentDx = minSegmentDx
        self.minTotalDistance = minTotalDistance
        self.maxNetDisplacement = maxNetDisplacement
        self.cooldownDuration = cooldownDuration
    }

    public func reset() {
        samples.removeAll(keepingCapacity: true)
    }

    public func addSample(x: Double, y: Double, timestamp: Double) -> Bool {
        // Enforce cooldown
        if timestamp - lastTriggerTime < cooldownDuration {
            return false
        }

        samples.append(PointSample(x: x, y: y, timestamp: timestamp))

        // Prune samples older than the sliding window
        let cutoff = timestamp - windowDuration
        while let first = samples.first, first.timestamp < cutoff {
            samples.removeFirst()
        }

        guard samples.count >= 4 else { return false }

        // Analyze horizontal trajectory
        var totalDistance: Double = 0.0
        var reversals = 0
        var currentDirection = 0 // +1: moving right, -1: moving left
        var currentSegmentDx: Double = 0.0

        for i in 1..<samples.count {
            let dx = samples[i].x - samples[i - 1].x
            totalDistance += abs(dx)

            if abs(dx) >= 3.0 {
                let dir = dx > 0 ? 1 : -1
                if currentDirection == 0 {
                    currentDirection = dir
                    currentSegmentDx = abs(dx)
                } else if dir == currentDirection {
                    currentSegmentDx += abs(dx)
                } else {
                    // Direction changed
                    if currentSegmentDx >= minSegmentDx {
                        reversals += 1
                    }
                    currentDirection = dir
                    currentSegmentDx = abs(dx)
                }
            }
        }

        // Account for final segment
        if currentSegmentDx >= minSegmentDx {
            // Completed current segment
        }

        guard let first = samples.first, let last = samples.last else { return false }
        let netDisplacement = abs(last.x - first.x)

        if reversals >= minReversals && totalDistance >= minTotalDistance && netDisplacement <= maxNetDisplacement {
            lastTriggerTime = timestamp
            reset()
            return true
        }

        return false
    }
}

// MARK: - Drag Pasteboard Inspection

func dragPasteboardHasFileUrls() -> Bool {
    guard let types = NSPasteboard(name: .drag).types else { return false }
    let validTypes: Set<String> = [
        "public.file-url",
        "NSFilenamesPboardType",
        "com.apple.finder.node",
        "dyn.ah62d4rv4gu8y6y4grf0gn5xbrzw1gydcr7u1e3cytf2gn"
    ]
    for type in types {
        if validTypes.contains(type.rawValue) {
            return true
        }
    }
    return false
}

// MARK: - JSON Output Helper

func emit(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
          let str = String(data: data, encoding: .utf8) else { return }
    print(str)
    fflush(stdout)
}

// MARK: - Automated Self-Test Runner

func runSelfTests() -> Bool {
    let detector = ShakeDetector()

    // Test 1: Normal straight drag movement (→ → → →) should NOT trigger
    detector.reset()
    var straightTriggered = false
    var t = 0.0
    for i in 0..<15 {
        t += 0.03
        if detector.addSample(x: Double(i * 30), y: 100.0, timestamp: t) {
            straightTriggered = true
        }
    }
    assert(!straightTriggered, "Straight movement must not trigger shake")

    // Test 2: Slow back and forth should NOT trigger (fails window cutoff / speed)
    detector.reset()
    var slowTriggered = false
    t = 0.0
    let slowSequence = [0.0, 40.0, 0.0, 40.0, 0.0]
    for x in slowSequence {
        t += 0.35 // each reversal takes 350ms, exceeding window duration
        if detector.addSample(x: x, y: 100.0, timestamp: t) {
            slowTriggered = true
        }
    }
    assert(!slowTriggered, "Slow movement must not trigger shake")

    // Test 3: Micro jitter (< minSegmentDx) should NOT trigger
    detector.reset()
    var jitterTriggered = false
    t = 0.0
    for i in 0..<20 {
        t += 0.02
        let x = (i % 2 == 0) ? 100.0 : 106.0
        if detector.addSample(x: x, y: 100.0, timestamp: t) {
            jitterTriggered = true
        }
    }
    assert(!jitterTriggered, "Micro jitter must not trigger shake")

    // Test 4: Valid rapid shake gesture (→ ← → ←) should trigger
    detector.reset()
    var shakeTriggered = false
    t = 10.0 // arbitrary start time
    // Rapid oscillation: 0 -> 45 -> 0 -> 45 -> 0 over ~350ms
    let shakeWaypoints: [(Double, Double)] = [
        (0.0, 0.0),
        (20.0, 0.03),
        (45.0, 0.07),  // Segment 1: +45px
        (20.0, 0.11),
        (0.0, 0.15),   // Segment 2: -45px (Reversal 1)
        (25.0, 0.19),
        (50.0, 0.23),  // Segment 3: +50px (Reversal 2)
        (20.0, 0.27),
        (0.0, 0.32),   // Segment 4: -50px (Reversal 3)
    ]

    for (x, dt) in shakeWaypoints {
        if detector.addSample(x: x, y: 100.0, timestamp: t + dt) {
            shakeTriggered = true
            break
        }
    }
    assert(shakeTriggered, "Valid rapid shake must trigger")

    // Test 5: Immediate second shake during cooldown should be suppressed
    var cooldownSuppressed = true
    for (x, dt) in shakeWaypoints {
        if detector.addSample(x: x, y: 100.0, timestamp: t + 0.35 + dt) {
            cooldownSuppressed = false
            break
        }
    }
    assert(cooldownSuppressed, "Cooldown must suppress retrigger")

    // Test 6: Shake after cooldown duration should trigger again
    t += 2.0 // advance past cooldown
    var secondShakeTriggered = false
    for (x, dt) in shakeWaypoints {
        if detector.addSample(x: x, y: 100.0, timestamp: t + dt) {
            secondShakeTriggered = true
            break
        }
    }
    assert(secondShakeTriggered, "Shake after cooldown must trigger")

    print("SHAKE_DETECTOR_TESTS_PASSED")
    return true
}

// MARK: - Main Application & Event Tap

if CommandLine.arguments.contains("--test") {
    if runSelfTests() {
        exit(0)
    } else {
        exit(1)
    }
}

let detector = ShakeDetector()
let eventMask: CGEventMask =
    (1 << CGEventType.leftMouseDragged.rawValue) |
    (1 << CGEventType.leftMouseUp.rawValue)

let callback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        return Unmanaged.passUnretained(event)
    }

    let location = event.location
    let now = ProcessInfo.processInfo.systemUptime

    if type == .leftMouseDragged {
        // Only evaluate shake when the drag pasteboard has files
        if dragPasteboardHasFileUrls() {
            if detector.addSample(x: location.x, y: location.y, timestamp: now) {
                emit([
                    "type": "shake",
                    "x": location.x,
                    "y": location.y,
                    "timestamp": now
                ])
            }
        }
    } else if type == .leftMouseUp {
        detector.reset()
        emit([
            "type": "drag_end",
            "x": location.x,
            "y": location.y,
            "timestamp": now
        ])
    }

    return Unmanaged.passUnretained(event)
}

guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: eventMask,
    callback: callback,
    userInfo: nil
) else {
    emit([
        "type": "error",
        "message": "Failed to create session event tap. Check macOS Accessibility / Input Monitoring permissions."
    ])
    exit(2)
}

guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
    emit(["type": "error", "message": "Failed to create run loop source"])
    exit(2)
}

CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

emit(["type": "ready"])
CFRunLoopRun()
