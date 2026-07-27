import Foundation

// Typed wrappers over the existing /api/* routes the podcasts screens consume.
extension APIClient {
    /// GET /api/jobs — recent episodes for the feed.
    func listJobs(limit: Int = 60) async throws -> [API.JobSummary] {
        let res: API.JobsResponse = try await get("/api/jobs?limit=\(limit)")
        return res.jobs
    }

    /// GET /api/jobs/[id] — full job + transcript segments.
    func jobDetail(id: String) async throws -> API.JobDetailResponse {
        try await get("/api/jobs/\(id)")
    }

    /// POST /api/translate-video — submit a YouTube URL.
    func createJob(url: String, targetLang: String, quality: String) async throws -> API.CreateJobResponse {
        try await post(
            "/api/translate-video",
            body: API.CreateJobRequest(url: url, targetLang: targetLang, quality: quality)
        )
    }

    /// PATCH /api/jobs/[id] — persist playback position / watch status.
    @discardableResult
    func updatePlayback(id: String, positionSec: Double? = nil, watchStatus: String? = nil) async throws -> API.OK {
        try await patch(
            "/api/jobs/\(id)",
            body: API.PlaybackUpdate(lastPositionSec: positionSec, watchStatus: watchStatus)
        )
    }

    /// Best-effort human-readable message from a thrown error (prefers the
    /// server's flat `{ error }` body).
    static func friendlyMessage(_ error: Error) -> String {
        if let api = error as? APIClient.APIError {
            if case let .http(_, body) = api,
               let flat = try? JSONDecoder().decode(API.FlatError.self, from: body),
               !flat.error.isEmpty {
                return flat.error
            }
            return api.errorDescription ?? "Ошибка сети"
        }
        return (error as NSError).localizedDescription
    }
}
