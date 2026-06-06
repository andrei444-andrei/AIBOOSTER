import Foundation

/// Feed state for English dialogues: list, polling while generating, create,
/// and watched toggle. Mirrors PodcastsStore.
@MainActor
final class EnglishStore: ObservableObject {
    enum Phase: Equatable {
        case idle, loading, loaded, failed(String)
    }

    @Published private(set) var jobs: [API.EnglishDialogueSummary] = []
    @Published private(set) var phase: Phase = .idle

    private let client = APIClient()
    private var pollTask: Task<Void, Never>?

    deinit { pollTask?.cancel() }

    func load(initial: Bool = false) async {
        if initial { phase = .loading }
        do {
            jobs = try await client.listDialogues(limit: 60)
            phase = .loaded
            ensurePolling()
        } catch {
            if jobs.isEmpty { phase = .failed(APIClient.friendlyMessage(error)) }
        }
    }

    /// Returns nil on success, or a message on failure.
    func create(topic: String, durationMin: Int, kind: String, withTranslation: Bool) async -> String? {
        do {
            _ = try await client.createDialogue(
                topic: topic, durationMin: durationMin, kind: kind, withTranslation: withTranslation
            )
            await load()
            return nil
        } catch {
            return APIClient.friendlyMessage(error)
        }
    }

    func setWatched(_ id: String, watched: Bool) async {
        try? await client.updateDialoguePlayback(id: id, watchStatus: watched ? "watched" : "to_watch")
        await load()
    }

    private var hasActiveJobs: Bool {
        jobs.contains { $0.status == "queued" || $0.status == "running" }
    }

    private func ensurePolling() {
        pollTask?.cancel()
        guard hasActiveJobs else { return }
        pollTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard let self, !Task.isCancelled, self.hasActiveJobs else { return }
                if let fresh = try? await self.client.listDialogues(limit: 60) {
                    self.jobs = fresh
                }
            }
        }
    }
}
