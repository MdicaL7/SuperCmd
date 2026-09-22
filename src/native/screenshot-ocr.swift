// Recognizes an existing PNG. Capture and clipboard behavior intentionally live
// outside this helper; the legacy screen-ocr extension protocol is unchanged.
import Foundation
import Vision
import AppKit

func finish(_ payload: [String: Any]) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: payload)
    print(String(data: data, encoding: .utf8)!)
    exit(0)
}

guard CommandLine.arguments.count == 2,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]) else {
    finish(["status": "error", "message": "Unable to read screenshot"])
}
var rect = NSRect.zero
guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
    finish(["status": "error", "message": "Invalid screenshot image"])
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }
do {
    try VNImageRequestHandler(cgImage: cgImage).perform([request])
    let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    finish(["status": "ok", "text": text])
} catch {
    finish(["status": "error", "message": error.localizedDescription])
}
