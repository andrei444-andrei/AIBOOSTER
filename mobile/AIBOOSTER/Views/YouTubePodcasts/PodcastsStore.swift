import Foundation

/// Feed state for the YouTube Podcasts screen: loads the episode list, polls
/// while anything is still processing, and submits new URLs.
@MainActor
final class PodcastsStore: ObservableObject {
    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    @Published private(set) var jobs: [API.JobSummary] = []
    @Published private(set) var phase: Phase = .idle

    private let client = APIClient()
    private var pollTask: Task<Void, Never>?

    deinit { pollTask?.cancel() }

    /// Load the feed. `initial` shows the full-screen loading state; refreshes
    /// keep the current list visible.
    func load(initial: Bool = false) async {
        if initial { phase = .loading }
        do {
            jobs = try await client.listJobs(limit: 60)
            phase = .loaded
            ensurePolling()
        } catch {
            if jobs.isEmpty {
                phase = .failed(APIClient.friendlyMessage(error))
            }
        }
    }

    /// Submit a URL. Returns nil on success, or a message on failure.
    func submit(url: String, lang: String, quality: String) async -> String? {
        do {
            _ = try await client.createJob(url: url, targetLang: lang, quality: quality)
            await load()
            return nil
        } catch {
            return APIClient.friendlyMessage(error)
        }
    }

    private var hasActiveJobs: Bool {
        jobs.contains { $0.status == .queued || $0.status == .running }
    }

    /// Poll every 5s while a job is processing, then stop on its own.
    private func ensurePolling() {
        pollTask?.cancel()
        guard hasActiveJobs else { return }
        pollTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard let self, !Task.isCancelled else { return }
                guard self.hasActiveJobs else { return }
                if let fresh = try? await self.client.listJobs(limit: 60) {
                    self.jobs = fresh
                }
            }
        }
    }
}
