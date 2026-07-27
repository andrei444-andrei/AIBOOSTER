import Foundation

// Typed wrappers over the open /api/english-dialogues/* routes.
extension APIClient {
    func listDialogues(limit: Int = 60) async throws -> [API.EnglishDialogueSummary] {
        let res: API.EnglishDialoguesResponse = try await get("/api/english-dialogues?limit=\(limit)")
        return res.jobs
    }

    func dialogueDetail(id: String) async throws -> API.EnglishDialogueDetailResponse {
        try await get("/api/english-dialogues/\(id)")
    }

    func createDialogue(topic: String, durationMin: Int, kind: String, withTranslation: Bool) async throws -> API.CreateDialogueResponse {
        try await post(
            "/api/english-dialogues",
            body: API.CreateDialogueRequest(
                topic: topic, durationMin: durationMin, kind: kind, withTranslation: withTranslation
            )
        )
    }

    @discardableResult
    func updateDialoguePlayback(id: String, positionSec: Double? = nil, watchStatus: String? = nil) async throws -> API.OK {
        try await patch(
            "/api/english-dialogues/\(id)",
            body: API.PlaybackUpdate(lastPositionSec: positionSec, watchStatus: watchStatus)
        )
    }
}
