import SwiftUI

/// News feature: a validated feed of items with AI deep-dives, plus the list
/// of items you've already reacted to. Backed by the open /api/news/* routes.
struct NewsView: View {
    @StateObject private var store = NewsStore()
    @State private var tab: NewsStore.Tab = .feed

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $tab) {
                Text("Лента").tag(NewsStore.Tab.feed)
                Text("Прочитано").tag(NewsStore.Tab.read)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, Theme.Space.s5)
            .padding(.top, Theme.Space.s2)
            .padding(.bottom, Theme.Space.s3)

            content
        }
        .background(Theme.pageBackground)
        .navigationTitle("Новости")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: tab) {
            if store.items(for: tab).isEmpty { await store.load(tab, initial: true) }
        }
    }

    @ViewBuilder private var content: some View {
        let items = store.items(for: tab)
        if items.isEmpty {
            switch store.phase(for: tab) {
            case .idle, .loading:
                loadingState
            case .failed(let message):
                errorState(message)
            case .loaded:
                emptyState
            }
        } else {
            list(items)
        }
    }

    private func list(_ items: [API.NewsItem]) -> some View {
        ScrollView {
            LazyVStack(spacing: Theme.Space.s3) {
                ForEach(items) { item in
                    NewsCard(item: item, showFeedback: tab == .feed, store: store)
                }
            }
            .padding(.horizontal, Theme.Space.s5)
            .padding(.bottom, Theme.Space.s10)
        }
        .refreshable { await store.load(tab) }
    }

    private var loadingState: some View {
        ScrollView {
            VStack(spacing: Theme.Space.s3) {
                ForEach(0..<4, id: \.self) { _ in NewsSkeleton() }
            }
            .padding(.horizontal, Theme.Space.s5)
        }
    }

    private var emptyState: some View {
        VStack(spacing: Theme.Space.s3) {
            Image(systemName: tab == .feed ? "newspaper" : "checkmark.circle")
                .font(.system(size: 40))
                .foregroundStyle(Theme.textMuted)
            Text(tab == .feed ? "Лента пуста" : "Пока ничего не прочитано")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.text)
            Text(tab == .feed
                 ? "Свежие материалы появятся, как только пройдут отбор."
                 : "Реакции на новости появятся здесь.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textMuted)
                .multilineTextAlignment(.center)
        }
        .padding(Theme.Space.s8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: Theme.Space.s4) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 40))
                .foregroundStyle(Theme.textMuted)
            Text("Не удалось загрузить новости")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.text)
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(Theme.textMuted)
                .multilineTextAlignment(.center)
            Button("Повторить") { Task { await store.load(tab, initial: true) } }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
        }
        .padding(Theme.Space.s8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct NewsSkeleton: View {
    @State private var pulse = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            bar(width: 120, height: 10)
            bar(width: nil, height: 14)
            bar(width: 220, height: 14)
            bar(width: nil, height: 10)
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
        .opacity(pulse ? 1 : 0.55)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { pulse = true }
        }
    }

    private func bar(width: CGFloat?, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(Theme.bgMuted)
            .frame(maxWidth: width ?? .infinity, alignment: .leading)
            .frame(height: height)
    }
}

#Preview {
    NavigationStack { NewsView() }
        .tint(Theme.accent)
}
