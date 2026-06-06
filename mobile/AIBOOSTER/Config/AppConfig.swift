import Foundation

enum AppConfig {
    static var apiBaseURL: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String,
           let url = URL(string: raw) {
            return url
        }
        return URL(string: "https://aibooster.vercel.app")!
    }

    static var bearerToken: String? {
        if let stored = Keychain.read(account: "api_token"), !stored.isEmpty {
            return stored
        }
        return Bundle.main.object(forInfoDictionaryKey: "DevAPIToken") as? String
    }
}
