import Foundation

enum ChatError: Error, LocalizedError {
    case api(String)
    var errorDescription: String? {
        if case let .api(m) = self { return m }
        return "Ошибка сети"
    }
}

/// Client for the chat module. Uses the `x-chat-uid` header (not Bearer) and
/// parses the SSE response stream from posting a message.
struct ChatClient {
    let baseURL: URL
    let uid: String

    init(baseURL: URL = AppConfig.apiBaseURL) {
        self.baseURL = baseURL
        self.uid = ChatClient.resolveUID()
    }

    /// Persistent per-install id, format ^[A-Za-z0-9_-]{8,64}$ (UUID fits).
    static func resolveUID() -> String {
        if let s = Keychain.read(account: "chat_uid"), !s.isEmpty { return s }
        let id = UUID().uuidString
        Keychain.write(id, account: "chat_uid")
        return id
    }

    // MARK: REST

    func listSessions() async throws -> [API.ChatSession] {
        let res: API.ChatSessionsResponse = try await get("/api/chat/sessions")
        return res.sessions
    }

    func createSession(mode: ChatMode) async throws -> API.ChatSession {
        let res: API.ChatSessionResponse = try await send(
            "/api/chat/sessions", method: "POST",
            body: API.CreateSessionRequest(mode: mode.wireValue)
        )
        return res.session
    }

    func sessionDetail(id: String) async throws -> API.ChatSessionDetailResponse {
        try await get("/api/chat/sessions/\(id)")
    }

    func deleteSession(id: String) async throws {
        let (data, resp) = try await URLSession.shared.data(
            for: makeRequest("/api/chat/sessions/\(id)", method: "DELETE")
        )
        try Self.check(resp, data)
    }

    // MARK: Streaming a reply (SSE)

    func streamMessage(sessionId: String, content: String, mode: ChatMode) -> AsyncThrowingStream<ChatEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var req = makeRequest("/api/chat/sessions/\(sessionId)/messages", method: "POST")
                    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    req.httpBody = try JSONEncoder().encode(
                        API.PostMessageRequest(content: content, mode: mode.wireValue)
                    )

                    let (bytes, resp) = try await URLSession.shared.bytes(for: req)
                    guard let http = resp as? HTTPURLResponse else {
                        throw ChatError.api("Некорректный ответ сервера")
                    }
                    guard (200..<300).contains(http.statusCode) else {
                        var buf = Data()
                        for try await b in bytes { buf.append(b) }
                        throw ChatError.api(Self.message(from: buf) ?? "HTTP \(http.statusCode)")
                    }

                    var event = ""
                    var dataBuf = ""
                    for try await line in bytes.lines {
                        if line.isEmpty {
                            if !dataBuf.isEmpty, let ev = Self.parseEvent(event, dataBuf) {
                                continuation.yield(ev)
                            }
                            event = ""
                            dataBuf = ""
                            continue
                        }
                        if line.hasPrefix("event:") {
                            event = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                        } else if line.hasPrefix("data:") {
                            dataBuf += String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                        }
                    }
                    if !dataBuf.isEmpty, let ev = Self.parseEvent(event, dataBuf) {
                        continuation.yield(ev)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: Voice transcription (multipart)

    func transcribe(fileURL: URL, language: String? = nil) async throws -> String {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/transcribe", method: "POST", auth: false)
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        let audio = try Data(contentsOf: fileURL)
        var body = Data()
        body.appendString("--\(boundary)\r\n")
        body.appendString("Content-Disposition: form-data; name=\"audio\"; filename=\"voice.m4a\"\r\n")
        body.appendString("Content-Type: audio/m4a\r\n\r\n")
        body.append(audio)
        body.appendString("\r\n")
        if let language {
            body.appendString("--\(boundary)\r\n")
            body.appendString("Content-Disposition: form-data; name=\"language\"\r\n\r\n")
            body.appendString("\(language)\r\n")
        }
        body.appendString("--\(boundary)--\r\n")
        req.httpBody = body

        let (data, resp) = try await URLSession.shared.data(for: req)
        try Self.check(resp, data)
        let res = try JSONDecoder().decode(API.TranscribeResponse.self, from: data)
        return res.text
    }

    // MARK: Helpers

    private func makeRequest(_ path: String, method: String, auth: Bool = true) -> URLRequest {
        let url = URL(string: path, relativeTo: baseURL) ?? baseURL
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if auth { req.setValue(uid, forHTTPHeaderField: "x-chat-uid") }
        return req
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let (data, resp) = try await URLSession.shared.data(for: makeRequest(path, method: "GET"))
        try Self.check(resp, data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func send<T: Decodable, B: Encodable>(_ path: String, method: String, body: B) async throws -> T {
        var req = makeRequest(path, method: method)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        try Self.check(resp, data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func check(_ resp: URLResponse, _ data: Data) throws {
        guard let http = resp as? HTTPURLResponse else { throw ChatError.api("Некорректный ответ сервера") }
        guard (200..<300).contains(http.statusCode) else {
            throw ChatError.api(message(from: data) ?? "HTTP \(http.statusCode)")
        }
    }

    static func message(from data: Data) -> String? {
        if let env = try? JSONDecoder().decode(API.ErrorEnvelope.self, from: data) { return env.error.message }
        if let flat = try? JSONDecoder().decode(API.FlatError.self, from: data) { return flat.error }
        return nil
    }

    static func friendlyMessage(_ error: Error) -> String {
        if let e = error as? ChatError { return e.errorDescription ?? "Ошибка сети" }
        return (error as NSError).localizedDescription
    }

    static func parseEvent(_ event: String, _ data: String) -> ChatEvent? {
        guard let d = data.data(using: .utf8) else { return nil }
        switch event {
        case "user_message":
            if let o = try? JSONDecoder().decode(SSEUserMessage.self, from: d) { return .userMessage(id: o.id) }
            return nil
        case "delta":
            if let o = try? JSONDecoder().decode(SSEDelta.self, from: d) { return .delta(o.text) }
            return nil
        case "image":
            if let o = try? JSONDecoder().decode(SSEImage.self, from: d) { return .image(base64: o.base64) }
            return nil
        case "done":
            return .done
        case "error":
            let m = (try? JSONDecoder().decode(SSEError.self, from: d))?.message
            return .error(m ?? "Ошибка генерации")
        default:
            return nil
        }
    }
}

private struct SSEUserMessage: Decodable { let id: String }
private struct SSEDelta: Decodable { let text: String }
private struct SSEImage: Decodable { let base64: String }
private struct SSEError: Decodable { let message: String }

private extension Data {
    mutating func appendString(_ string: String) {
        if let d = string.data(using: .utf8) { append(d) }
    }
}
