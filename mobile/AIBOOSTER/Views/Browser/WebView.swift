import SwiftUI
import WebKit

/// WKWebView wrapper. Reports load progress so the host can show a thin bar,
/// keeps edge-swipe navigation inside the site, and follows `target="_blank"`
/// links in place (a plain WKWebView would silently drop them).
struct WebView: UIViewRepresentable {
    let url: URL
    var onProgress: (Double) -> Void
    var onLoadingChange: (Bool) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let view = WKWebView(frame: .zero, configuration: config)
        view.allowsBackForwardNavigationGestures = true
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        // The view itself is edge-to-edge; let the scroll view keep content
        // clear of the notch / home indicator.
        view.scrollView.contentInsetAdjustmentBehavior = .always
        context.coordinator.observeProgress(of: view)
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        // Keep the callbacks fresh; the URL is fixed for this view's lifetime.
        context.coordinator.parent = self
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.stopObserving()
        view.stopLoading()
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: WebView
        private var progressToken: NSKeyValueObservation?

        init(_ parent: WebView) {
            self.parent = parent
        }

        func observeProgress(of view: WKWebView) {
            progressToken = view.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
                guard let self else { return }
                let value = webView.estimatedProgress
                DispatchQueue.main.async { self.parent.onProgress(value) }
            }
        }

        func stopObserving() {
            progressToken?.invalidate()
            progressToken = nil
        }

        // MARK: Navigation

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.onLoadingChange(true)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.onLoadingChange(false)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.onLoadingChange(false)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            parent.onLoadingChange(false)
        }

        // MARK: New windows

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
                webView.load(URLRequest(url: url))
            }
            return nil
        }
    }
}
