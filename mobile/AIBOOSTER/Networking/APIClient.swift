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

    private func send<T: Decodable>(path: String, method: String, body: Data?) async throws -> T {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
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
            throw APIError.http(status: http.statusCode, body: data)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}
