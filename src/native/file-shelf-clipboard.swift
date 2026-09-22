import AppKit
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let data = FileHandle.standardInput.readDataToEndOfFile()
guard let paths = try? JSONDecoder().decode([String].self, from: data), !paths.isEmpty else {
    fail("Select at least one file.")
}
var urls: [NSURL] = []
for path in paths {
    guard path.hasPrefix("/"), !path.contains("\0"), FileManager.default.isReadableFile(atPath: path) else {
        fail("A source file is unavailable or cannot be read.")
    }
    urls.append(URL(fileURLWithPath: path) as NSURL)
}

// Validation mode supports fixtures without touching the user's clipboard.
if CommandLine.arguments.contains("--validate") {
    print("Validated \(urls.count) file reference(s).")
    exit(0)
}

let pasteboard = NSPasteboard.general
pasteboard.clearContents()
guard pasteboard.writeObjects(urls) else { fail("Could not copy the selected files.") }
print("Copied \(urls.count) file reference(s).")
