import Foundation

/// State for the News screen: the validated feed and the read list, plus
/// feedback (which moves an item from feed → read).
@MainActor
final class NewsStore: ObservableObject {
    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    enum Tab: Hashable { case feed, read }

    @Published private(set) var feed: [API.NewsItem] = []
    @Published private(set) var read: [API.NewsItem] = []
    @Published private(set) var feedPhase: Phase = .idle
    @Published private(set) var readPhase: Phase = .idle

    private let client = APIClient()

    func items(for tab: Tab) -> [API.NewsItem] { tab == .feed ? feed : read }
    func phase(for tab: Tab) -> Phase { tab == .feed ? feedPhase : readPhase }

    func load(_ tab: Tab, initial: Bool = false) async {
        switch tab {
        case .feed:
            if initial { feedPhase = .loading }
            do { feed = try await client.newsFeed(); feedPhase = .loaded }
            catch { if feed.isEmpty { feedPhase = .failed(APIClient.friendlyMessage(error)) } }
        case .read:
            if initial { readPhase = .loading }
            do { read = try await client.newsRead(); readPhase = .loaded }
            catch { if read.isEmpty { readPhase = .failed(APIClient.friendlyMessage(error)) } }
        }
    }

    /// Send like/dislike/hide. On success the item leaves the feed; the read
    /// list is invalidated so it reloads when that tab is next shown.
    func sendFeedback(itemId: String, signal: String) async -> String? {
        do {
            try await client.sendNewsFeedback(itemId: itemId, signal: signal)
            feed.removeAll { $0.id == itemId }
            read = []
            readPhase = .idle
            return nil
        } catch {
            return APIClient.friendlyMessage(error)
        }
    }
}
