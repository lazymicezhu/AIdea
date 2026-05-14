#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="AIdea"
DIST_DIR="$ROOT_DIR/dist"
APP_DIR="$DIST_DIR/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
BUNDLED_APP_DIR="$RESOURCES_DIR/app"
BUILD_DIR="$DIST_DIR/build"
SWIFT_SOURCE="$BUILD_DIR/AIdeaApp.swift"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$BUNDLED_APP_DIR" "$BUILD_DIR"

cp "$ROOT_DIR/index.html" "$BUNDLED_APP_DIR/"
cp "$ROOT_DIR/styles.css" "$BUNDLED_APP_DIR/"
cp "$ROOT_DIR/app.js" "$BUNDLED_APP_DIR/"
cp "$ROOT_DIR/server.js" "$BUNDLED_APP_DIR/"
cp "$ROOT_DIR/pdf-export.swift" "$BUNDLED_APP_DIR/"
cp "$ROOT_DIR/README.md" "$BUNDLED_APP_DIR/"

if [ -f "$ROOT_DIR/.env" ]; then
  cp "$ROOT_DIR/.env" "$BUNDLED_APP_DIR/.env"
fi

if [ -d "$ROOT_DIR/assets" ]; then
  mkdir -p "$BUNDLED_APP_DIR/assets"
  ditto "$ROOT_DIR/assets" "$BUNDLED_APP_DIR/assets"
fi

cat > "$CONTENTS_DIR/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>AIdea</string>
  <key>CFBundleDisplayName</key>
  <string>AIdea</string>
  <key>CFBundleIdentifier</key>
  <string>com.lazymice.aidea</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleExecutable</key>
  <string>AIdea</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

cat > "$SWIFT_SOURCE" <<'SWIFT'
import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var serverProcess: Process?
    private var launchedServer = false

    private let port = ProcessInfo.processInfo.environment["AIDEA_PORT"] ?? "4173"
    private var url: URL {
        URL(string: "http://localhost:\(port)/index.html")!
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        makeMenu()
        makeWindow()
        startServerIfNeeded()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        if launchedServer, let serverProcess, serverProcess.isRunning {
            serverProcess.terminate()
        }
    }

    private func makeMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "退出 AIdea", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appItem.submenu = appMenu
        menu.addItem(appItem)
        NSApp.mainMenu = menu
    }

    private func makeWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = false
        webView.uiDelegate = self

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 980, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "AIdea"
        window.minSize = NSSize(width: 720, height: 560)
        window.center()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)

        self.webView = webView
        self.window = window
        NSApp.activate(ignoringOtherApps: true)
    }

    private func startServerIfNeeded() {
        if isServerReady() {
            loadApp()
            return
        }

        guard let nodePath = findNodePath() else {
            showAlert("AIdea 需要先安装 Node.js 才能启动本地服务。")
            return
        }

        guard let appDir = Bundle.main.resourceURL?.appendingPathComponent("app") else {
            showAlert("AIdea 应用资源缺失，无法启动。")
            return
        }

        let logDir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/AIdea", isDirectory: true)
        try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
        let logURL = logDir.appendingPathComponent("server.log")
        FileManager.default.createFile(atPath: logURL.path, contents: nil)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: nodePath)
        process.arguments = ["server.js"]
        process.currentDirectoryURL = appDir
        process.environment = ProcessInfo.processInfo.environment.merging(["PORT": port]) { _, new in new }

        if let logHandle = try? FileHandle(forWritingTo: logURL) {
            logHandle.seekToEndOfFile()
            process.standardOutput = logHandle
            process.standardError = logHandle
        }

        do {
            try process.run()
            serverProcess = process
            launchedServer = true
            waitForServer(attemptsRemaining: 40)
        } catch {
            showAlert("AIdea 本地服务启动失败：\(error.localizedDescription)")
        }
    }

    private func waitForServer(attemptsRemaining: Int) {
        if isServerReady() {
            loadApp()
            return
        }

        if attemptsRemaining <= 0 {
            showAlert("AIdea 本地服务启动失败，请查看 ~/Library/Logs/AIdea/server.log。")
            return
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            self.waitForServer(attemptsRemaining: attemptsRemaining - 1)
        }
    }

    private func loadApp() {
        webView?.load(URLRequest(url: url))
    }

    private func isServerReady() -> Bool {
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"

        let semaphore = DispatchSemaphore(value: 0)
        var ready = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            if let httpResponse = response as? HTTPURLResponse,
               (200...399).contains(httpResponse.statusCode) {
                ready = true
            }
            semaphore.signal()
        }.resume()

        _ = semaphore.wait(timeout: .now() + 0.4)
        return ready
    }

    private func findNodePath() -> String? {
        let environmentPath = ProcessInfo.processInfo.environment["AIDEA_NODE_PATH"]
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            environmentPath,
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
            "\(home)/.nvm/current/bin/node",
            "\(home)/.volta/bin/node",
            "\(home)/.asdf/shims/node"
        ]

        for candidate in candidates.compactMap({ $0 }) {
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
        return nil
    }

    private func showAlert(_ message: String) {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "好")
        alert.runModal()
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = .informational
        alert.addButton(withTitle: "好")
        alert.beginSheetModal(for: window!) { _ in
            completionHandler()
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "删除")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window!) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
SWIFT

swiftc "$SWIFT_SOURCE" -o "$MACOS_DIR/$APP_NAME" -framework Cocoa -framework WebKit

echo "Built $APP_DIR"
