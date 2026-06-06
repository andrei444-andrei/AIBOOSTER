import Foundation

/// Selectable chat modes. `auto` maps to a nil `mode` (server picks).
enum ChatMode: String, CaseIterable, Identifiable, Hashable {
    case auto, thinking, pro, judge, image

    var id: String { rawValue }

    var title: String {
        switch self {
        case .auto:     return "Авто"
        case .thinking: return "Обычный"
        case .pro:      return "Глубокий"
        case .judge:    return "Ансамбль"
        case .image:    return "Картинка"
        }
    }

    var systemImage: String {
        switch self {
        case .auto:     return "wand.and.stars"
        case .thinking: return "bubble.left"
        case .pro:      return "brain"
        case .judge:    return "person.3"
        case .image:    return "photo"
        }
    }

    /// Wire value sent to the API (nil = Auto).
    var wireValue: String? { self == .auto ? nil : rawValue }
}

/// Parsed SSE event from the message stream (only what mobile renders).
enum ChatEvent {
    case userMessage(id: String)
    case delta(String)
    case image(base64: String)
    case done
    case error(String)
}

/// A message as rendered in the thread (mutable while streaming).
struct DisplayMessage: Identifiable {
    let id: String
    let role: String          // "user" | "assistant"
    var content: String
    var imageBase64: String?
    var isStreaming: Bool
    var failed: Bool

    var isUser: Bool { role == "user" }

    init(id: String = UUID().uuidString, role: String, content: String,
         imageBase64: String? = nil, isStreaming: Bool = false, failed: Bool = false) {
        self.id = id
        self.role = role
        self.content = content
        self.imageBase64 = imageBase64
        self.isStreaming = isStreaming
        self.failed = failed
    }

    init(_ m: API.ChatMessage) {
        self.init(id: m.id, role: m.role, content: m.content)
    }
}
