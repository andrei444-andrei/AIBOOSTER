import SwiftUI

/// List of chat sessions with a "new chat" action. Tapping opens the thread.
struct ChatSessionsView: View {
    enum Phase: Equatable { case loading, loaded, failed(String) }

    @State private var sessions: [API.ChatSession] = []
    @State private var phase: Phase = .loading
    @State private var selected: API.ChatSession?
    @State private var creating = false

    private let client = ChatClient()

    var body: some View {
        content
            .background(Theme.pageBackground)
            .navigationTitle("Чат")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { newChat() } label: {
                        if creating { ProgressView() } else { Image(systemName: "square.and.pencil") }
                    }
                    .disabled(creating)
                }
            }
            .navigationDestination(item: $selected) { session in
                ChatThreadView(session: session)
            }
            .onChange(of: selected) { _, new in
                if new == nil { Task { await load() } }
            }
            .task { if sessions.isEmpty { await load() } }
    }

    @ViewBuilder private var content: some View {
        if sessions.isEmpty {
            switch phase {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let message):
                errorState(message)
            case .loaded:
                emptyState
            }
        } else {
            list
        }
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: Theme.Space.s2) {
                ForEach(sessions) { session in
                    Button { selected = session } label: { row(session) }
                        .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, Theme.Space.s5)
            .padding(.top, Theme.Space.s3)
            .padding(.bottom, Theme.Space.s10)
        }
        .refreshable { await load() }
    }

    private func row(_ session: API.ChatSession) -> some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 16))
                .foregroundStyle(Theme.accent)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                if let rel = NewsFormat.relative(session.updatedAt) {
                    Text(rel).font(.system(size: 12)).foregroundStyle(Theme.textMuted)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(Theme.textMuted)
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .fill(Theme.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                        .stroke(Theme.border, lineWidth: 1)
                )
        )
    }

    private var emptyState: some View {
        VStack(spacing: Theme.Space.s4) {
            IconBadge(systemImage: "bubble.left.and.bubble.right.fill", tint: Theme.accent, size: 60)
            Text("Чатов пока нет")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.text)
            Button { newChat() } label: {
                HStack(spacing: 6) {
                    Image(systemName: "square.and.pencil")
                    Text("Новый чат")
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, Theme.Space.s5)
                .padding(.vertical, Theme.Space.s3)
                .background(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous).fill(Theme.accent))
            }
            .buttonStyle(PressableStyle())
            .disabled(creating)
        }
        .padding(Theme.Space.s8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: Theme.Space.s4) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 40)).foregroundStyle(Theme.textMuted)
            Text("Не удалось загрузить чаты").font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.text)
            Text(message).font(.system(size: 13)).foregroundStyle(Theme.textMuted).multilineTextAlignment(.center)
            Button("Повторить") { Task { await load() } }
                .buttonStyle(.borderedProminent).tint(Theme.accent)
        }
        .padding(Theme.Space.s8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func load() async {
        do {
            sessions = try await client.listSessions()
            phase = .loaded
        } catch {
            if sessions.isEmpty { phase = .failed(ChatClient.friendlyMessage(error)) }
        }
    }

    private func newChat() {
        guard !creating else { return }
        creating = true
        Task {
            defer { creating = false }
            do {
                let session = try await client.createSession(mode: .auto)
                sessions.insert(session, at: 0)
                selected = session
            } catch {
                phase = .failed(ChatClient.friendlyMessage(error))
            }
        }
    }
}

#Preview {
    NavigationStack { ChatSessionsView() }
        .tint(Theme.accent)
}
