import Foundation

// Typed wrappers over the existing open /api/news/* routes.
extension APIClient {
    /// GET /api/news/items — validated feed (unread, verdict=show).
    func newsFeed(limit: Int = 50) async throws -> [API.NewsItem] {
        let res: API.NewsItemsResponse = try await get("/api/news/items?verdict=show&limit=\(limit)")
        return res.items
    }

    /// GET /api/news/items/read — items the user reacted to.
    func newsRead(limit: Int = 100) async throws -> [API.NewsItem] {
        let res: API.NewsItemsResponse = try await get("/api/news/items/read?limit=\(limit)")
        return res.items
    }

    /// GET /api/news/enrichment?item_id= — latest deep-dive for one item.
    func newsEnrichment(itemId: String) async throws -> API.NewsEnrichment? {
        let res: API.NewsEnrichmentResponse = try await get("/api/news/enrichment?item_id=\(itemId)")
        return res.enrichment
    }

    /// POST /api/news/feedback — like/dislike/hide; marks the item read.
    @discardableResult
    func sendNewsFeedback(itemId: String, signal: String, reason: String? = nil) async throws -> API.OK {
        try await post(
            "/api/news/feedback",
            body: API.NewsFeedbackRequest(itemId: itemId, signal: signal, reasonChip: reason, customText: nil)
        )
    }
}
