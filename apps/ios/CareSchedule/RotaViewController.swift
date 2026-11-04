import UIKit
import WebKit

/// Shows CareSchedule.html and does the things a web page can't do on an iPhone:
/// pop-up messages, sharing files, making PDFs and printing.
final class RotaViewController: UIViewController, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private static let scheme = "careschedule"
    private var webView: WKWebView!

    override func loadView() {
        let config = WKWebViewConfiguration()
        // The page is served from the app's own files under careschedule://app/ – a fixed address,
        // so the copy of the rota kept on the phone (for viewing offline) stays put between launches.
        config.setURLSchemeHandler(BundleFiles(), forURLScheme: Self.scheme)
        config.websiteDataStore = .default()

        let content = config.userContentController
        content.addUserScript(WKUserScript(source: "window.careConfig = \(Self.pageConfig());",
                                           injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.add(WeakHandler(self), name: "care")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        if #available(iOS 16.4, *) {
            webView.isInspectable = true // lets Safari's Develop menu look inside, when plugged into a Mac
        }
        view = webView
        view.backgroundColor = .systemBackground
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: URL(string: "\(Self.scheme)://app/CareSchedule.html")!))
    }

    /// config.json (bundled from apps/config.json) holds the shared-storage details, so staff don't
    /// have to type them in. Left blank, they are entered once under Settings & Data instead.
    private static func pageConfig() -> String {
        var cfg: [String: Any] = [:]
        if let url = Bundle.main.url(forResource: "config", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            cfg = json
        }
        cfg["device"] = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        let data = (try? JSONSerialization.data(withJSONObject: cfg)) ?? Data("{}".utf8)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    // MARK: messages from the page (see nativeApp() in CareSchedule.html)

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let kind = body["kind"] as? String else { return }
        let name = Self.safeName(body["name"] as? String ?? "CareSchedule")
        let landscape = body["landscape"] as? Bool ?? false
        switch kind {
        case "file":
            guard let b64 = body["base64"] as? String, let data = Data(base64Encoded: b64) else { return }
            share(data, named: name)
        case "pdf":
            share(makePDF(landscape: landscape), named: name.hasSuffix(".pdf") ? name : name + ".pdf")
        case "print":
            printPage(name: name, landscape: landscape)
        default:
            break
        }
    }

    private static func safeName(_ name: String) -> String {
        let bad = CharacterSet(charactersIn: "/\\:?%*|\"<>")
        return name.components(separatedBy: bad).joined(separator: "-")
    }

    /// Opens the share sheet (Mail, WhatsApp, Save to Files, AirDrop…) for a file.
    private func share(_ data: Data, named name: String) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("share", isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent(name)
        do {
            try data.write(to: file)
        } catch {
            showMessage("Could not make the file: \(error.localizedDescription)")
            return
        }
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        if let pop = sheet.popoverPresentationController { // iPad
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        topController().present(sheet, animated: true)
    }

    /// A4 pages laid out with the page's print styles – the same PDFs the desktop app makes.
    private func makePDF(landscape: Bool) -> Data {
        let a4 = CGSize(width: 595.2, height: 841.8) // points
        let paper = CGRect(origin: .zero, size: landscape ? CGSize(width: a4.height, height: a4.width) : a4)
        let margin: CGFloat = 28.35 // 10 mm
        let renderer = UIPrintPageRenderer()
        renderer.addPrintFormatter(webView.viewPrintFormatter(), startingAtPageAt: 0)
        renderer.setValue(NSValue(cgRect: paper), forKey: "paperRect")
        renderer.setValue(NSValue(cgRect: paper.insetBy(dx: margin, dy: margin)), forKey: "printableRect")

        let pdf = NSMutableData()
        UIGraphicsBeginPDFContextToData(pdf, paper, nil)
        let pages = renderer.numberOfPages
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: pages))
        for page in 0..<pages {
            UIGraphicsBeginPDFPage()
            renderer.drawPage(at: page, in: UIGraphicsGetPDFContextBounds())
        }
        UIGraphicsEndPDFContext()
        return pdf as Data
    }

    private func printPage(name: String, landscape: Bool) {
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = name
        info.outputType = .general
        info.orientation = landscape ? .landscape : .portrait
        let printer = UIPrintInteractionController.shared
        printer.printInfo = info
        printer.printFormatter = webView.viewPrintFormatter()
        if UIDevice.current.userInterfaceIdiom == .pad {
            printer.present(from: CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1), in: view, animated: true)
        } else {
            printer.present(animated: true)
        }
    }

    // MARK: alert() and confirm() from the page

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, orElse: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, orElse: { completionHandler(false) })
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        present(alert, orElse: { completionHandler(nil) })
    }

    /// The page waits for an answer, so if the message can't be shown it must still get one.
    private func present(_ alert: UIAlertController, orElse fallback: @escaping () -> Void) {
        let top = topController()
        guard view.window != nil, !(top is UIAlertController), !top.isBeingDismissed else { fallback(); return }
        top.present(alert, animated: true)
    }

    private func showMessage(_ text: String) {
        let alert = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        topController().present(alert, animated: true)
    }

    private func topController() -> UIViewController {
        var top: UIViewController = self
        while let next = top.presentedViewController { top = next }
        return top
    }

    // MARK: links

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == Self.scheme || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
            decisionHandler(.allow)
        } else {
            // a web link: open it in Safari rather than replacing the rota
            if action.navigationType == .linkActivated || action.targetFrame == nil {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, url.scheme == "https" || url.scheme == "http" { UIApplication.shared.open(url) }
        return nil
    }

    // iOS can stop a web view in the background to free memory – load the page again if so.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}

/// Serves CareSchedule.html (and anything else bundled with the app) at careschedule://app/…
private final class BundleFiles: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let path = url.path.isEmpty || url.path == "/" ? "CareSchedule.html" : String(url.path.dropFirst())
        guard !path.contains(".."),
              let file = Bundle.main.url(forResource: path, withExtension: nil),
              let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let types = ["html": "text/html; charset=utf-8", "json": "application/json", "js": "text/javascript", "css": "text/css"]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": types[file.pathExtension.lowercased()] ?? "application/octet-stream",
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache",
        ])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// WKUserContentController holds on to its message handlers; this stops it keeping the screen alive.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
