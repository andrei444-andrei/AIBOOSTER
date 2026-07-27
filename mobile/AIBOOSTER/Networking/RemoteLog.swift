import Foundation

/// Fire-and-forget client error logging to the web `/api/log` sink (§2).
/// Errors land in `app_errors` (source=client) and show up at /admin and via
/// GET /api/admin/errors, so failures on device can be diagnosed remotely.
enum RemoteLog {
    static func error(_ message: String, route: String? = nil, meta: [String: String]? = nil) {
        send(level: "error", message: message, route: route, meta: meta)
    }

    static func warn(_ message: String, route: String? = nil, meta: [String: String]? = nil) {
        send(level: "warn", message: message, route: route, meta: meta)
    }

    private static func send(level: String, message: String, route: String?, meta: [String: String]?) {
        guard let url = URL(string: "/api/log", relativeTo: AppConfig.apiBaseURL) else { return }
        var body: [String: Any] = [
            "level": level,
            "message": String(message.prefix(4000)),
            "build": build
        ]
        if let route { body["route"] = route }
        if let meta { body["meta"] = meta }
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data
        URLSession.shared.dataTask(with: req).resume()
    }

    static var build: String {
        let info = Bundle.main.infoDictionary
        let v = info?["CFBundleShortVersionString"] as? String ?? "?"
        let b = info?["CFBundleVersion"] as? String ?? "?"
        return "ios \(v) (\(b))"
    }
}
