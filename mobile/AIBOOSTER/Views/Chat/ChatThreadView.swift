import SwiftUI

/// Holds the message list for one session and drives streaming replies.
@MainActor
final class ChatThreadStore: ObservableObject {
    @Published var messages: [DisplayMessage] = []
    @Published var loaded = false
    @Published var loadError: String?
    @Published var streaming = false

    let sessionId: String
    private let client = ChatClient()
    private var streamTask: Task<Void, Never>?

    init(sessionId: String) { self.sessionId = sessionId }

    func load() async {
        do {
            let detail = try await client.sessionDetail(id: sessionId)
            messages = detail.messages.map(DisplayMessage.init)
            loaded = true
        } catch {
            loadError = ChatClient.friendlyMessage(error)
            loaded = true
        }
    }

    func send(_ text: String, mode: ChatMode) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !streaming else { return }

        messages.append(DisplayMessage(role: "user", content: trimmed))
        let assistantId = UUID().uuidString
        messages.append(DisplayMessage(id: assistantId, role: "assistant", content: "", isStreaming: true))
        streaming = true

        streamTask = Task { @MainActor in
            do {
                for try await event in client.streamMessage(sessionId: sessionId, content: trimmed, mode: mode) {
                    switch event {
                    case .delta(let t):
                        update(assistantId) { $0.content += t }
                    case .image(let b64):
                        update(assistantId) { $0.imageBase64 = b64 }
                    case .error(let m):
                        update(assistantId) {
                            if $0.content.isEmpty { $0.content = m }
                            $0.failed = true
                            $0.isStreaming = false
                        }
                    case .done:
                        update(assistantId) { $0.isStreaming = false }
                    case .userMessage:
                        break
                    }
                }
                update(assistantId) { $0.isStreaming = false }
            } catch {
                update(assistantId) {
                    $0.isStreaming = false
                    if $0.content.isEmpty {
                        $0.content = ChatClient.friendlyMessage(error)
                        $0.failed = true
                    }
                }
            }
            streaming = false
        }
    }

    func stop() {
        streamTask?.cancel()
        streaming = false
    }

    private func update(_ id: String, _ mutate: (inout DisplayMessage) -> Void) {
        if let i = messages.firstIndex(where: { $0.id == id }) { mutate(&messages[i]) }
    }
}

struct ChatThreadView: View {
    let session: API.ChatSession
    let initialMessage: String?

    @StateObject private var store: ChatThreadStore
    @State private var text = ""
    @State private var mode: ChatMode
    @State private var sentInitial = false

    init(session: API.ChatSession, initialMessage: String? = nil) {
        self.session = session
        self.initialMessage = initialMessage
        _store = StateObject(wrappedValue: ChatThreadStore(sessionId: session.id))
        _mode = State(initialValue: ChatMode(rawValue: session.mode ?? "auto") ?? .auto)
    }

    var body: some View {
        VStack(spacing: 0) {
            messages
            ChatComposer(text: $text, mode: $mode, sending: store.streaming) { send() }
        }
        .background(Theme.pageBackground)
        .navigationTitle(session.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if !store.loaded { await store.load() }
            if let initial = initialMessage, !sentInitial {
                sentInitial = true
                store.send(initial, mode: mode)
            }
        }
    }

    private var messages: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: Theme.Space.s3) {
                    if store.messages.isEmpty && store.loaded {
                        Text("Напиши или надиктуй сообщение — и поехали.")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textMuted)
                            .padding(.top, Theme.Space.s10)
                    }
                    ForEach(store.messages) { msg in
                        MessageBubble(message: msg).id(msg.id)
                    }
                }
                .padding(.horizontal, Theme.Space.s4)
                .padding(.vertical, Theme.Space.s4)
            }
            .onChange(of: store.messages.count) { _, _ in scrollToBottom(proxy) }
            .onChange(of: store.messages.last?.content) { _, _ in scrollToBottom(proxy) }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        guard let id = store.messages.last?.id else { return }
        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .bottom) }
    }

    private func send() {
        let t = text
        text = ""
        store.send(t, mode: mode)
    }
}
