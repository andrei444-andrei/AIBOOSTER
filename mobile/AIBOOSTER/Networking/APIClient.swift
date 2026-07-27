import Foundation

struct APIClient {
    let baseURL: URL
    let token: String?
    let session: URLSession

    init(
        baseURL: URL = AppConfig.apiBaseURL,
        token: String? = AppConfig.bearerToken,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
    }

    enum APIError: Error, LocalizedError {
        case invalidResponse
        case http(status: Int, body: Data)
        case decoding(Error)

        var errorDescription: String? {
            switch self {
            case .invalidResponse: return "Некорректный ответ сервера"
            case .http(let status, _): return "HTTP \(status)"
            case .decoding(let err): return "Decoding: \(err.localizedDescription)"
            }
        }
    }

    func get<T: Decodable>(_ path: String, as _: T.Type = T.self) async throws -> T {
        try await send(path: path, method: "GET", body: nil)
    }

    func post<T: Decodable, Body: Encodable>(
        _ path: String,
        body: Body,
        as _: T.Type = T.self
    ) async throws -> T {
        let data = try JSONEncoder().encode(body)
        return try await send(path: path, method: "POST", body: data)
    }

    func patch<T: Decodable, Body: Encodable>(
        _ path: String,
        body: Body,
        as _: T.Type = T.self
    ) async throws -> T {
        let data = try JSONEncoder().encode(body)
        return try await send(path: path, method: "PATCH", body: data)
    }

    private func send<T: Decodable>(path: String, method: String, body: Data?) async throws -> T {
        // Resolve `path` (which may carry a query string) relative to baseURL.
        // appendingPathComponent would percent-encode "?" and "=", so use
        // relative URL resolution instead.
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.invalidResponse
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode >= 500 {
                RemoteLog.error("HTTP \(http.statusCode) \(method) \(path)", route: path)
            }
            throw APIError.http(status: http.statusCode, body: data)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            RemoteLog.error("decode failed \(path): \(error)", route: path)
            throw APIError.decoding(error)
        }
    }
}
