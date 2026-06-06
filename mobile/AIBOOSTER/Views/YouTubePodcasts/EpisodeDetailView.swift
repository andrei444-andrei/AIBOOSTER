import SwiftUI

/// One episode: header, audio player (when ready) or processing/error state,
/// chapters, and the translated transcript. Resumes from / saves the playback
/// position and can mark the episode watched.
struct EpisodeDetailView: View {
    let summary: API.JobSummary
    let store: PodcastsStore

    @StateObject private var player = AudioPlayer()
    @State private var detail: API.JobDetail?
    @State private var segments: [API.Segment] = []
    @State private var loadError: String?
    @State private var showOriginal = false
    @State private var didStartAudio = false
    @State private var watchedOverride: Bool?

    private let client = APIClient()

    private var status: API.JobStatus { detail?.status ?? summary.status }
    private var audioURL: String? { detail?.audioURL ?? summary.audioURL }
    private var isWatched: Bool {
        watchedOverride ?? ((detail?.watchStatus ?? summary.watchStatus) == .watched)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s5) {
                header
                statusSection
                chaptersSection
                if !segments.isEmpty { transcriptSection }
            }
            .padding(.horizontal, Theme.Space.s5)
            .padding(.vertical, Theme.Space.s4)
        }
        .background(Theme.pageBackground)
        .navigationTitle(summary.title ?? "Эпизод")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        let next = !isWatched
                        watchedOverride = next
                        Task { await store.setWatched(summary.id, watched: next) }
                    } label: {
                        Label(isWatched ? "Вернуть в «Слушать»" : "Отметить прослушанным",
                              systemImage: isWatched ? "arrow.uturn.left" : "checkmark.circle")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .onDisappear { savePositionAndStop() }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            ZStack {
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .fill(Theme.bgMuted)
                AsyncImage(url: PodcastFormat.thumbnailURL(summary.videoId)) { phase in
                    if let image = phase.image {
                        image.resizable().aspectRatio(contentMode: .fill)
                    } else {
                        Image(systemName: "play.rectangle.fill")
                            .font(.system(size: 40))
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            }
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))

            Text(summary.title ?? "Без названия")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)

            if let summaryText = detail?.summary ?? summary.summary, !summaryText.isEmpty {
                Text(summaryText)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: Status / player

    @ViewBuilder private var statusSection: some View {
        if let audio = audioURL, status == .done {
            playerCard(audio: audio)
        } else if status == .error {
            infoCard(icon: "exclamationmark.triangle.fill", tint: Theme.youtube,
                     text: detail?.errorMessage ?? "Не удалось обработать видео.")
        } else if status == .cancelled {
            infoCard(icon: "xmark.circle.fill", tint: Theme.textMuted, text: "Обработка отменена.")
        } else {
            processingCard
        }
    }

    private func playerCard(audio: String) -> some View {
        VStack(spacing: Theme.Space.s4) {
            Slider(
                value: Binding(get: { player.currentTime }, set: { player.seek(to: $0) }),
                in: 0...max(player.duration, 1)
            )
            .tint(Theme.youtube)

            HStack {
                Text(PodcastFormat.time(player.currentTime))
                Spacer()
                Text(player.duration > 0 ? PodcastFormat.time(player.duration) : "—:—")
            }
            .font(.system(size: 12, design: .monospaced))
            .foregroundStyle(Theme.textMuted)

            HStack(spacing: Theme.Space.s8) {
                Button { player.skip(by: -15) } label: {
                    Image(systemName: "gobackward.15").font(.system(size: 24))
                }
                Button { player.togglePlay() } label: {
                    Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 58))
                }
                Button { player.skip(by: 30) } label: {
                    Image(systemName: "goforward.30").font(.system(size: 24))
                }
            }
            .foregroundStyle(Theme.accent)
        }
        .padding(Theme.Space.s5)
        .frame(maxWidth: .infinity)
        .background(cardBackground)
        .onAppear { startAudioIfPossible() }
    }

    private var processingCard: some View {
        let info = PodcastFormat.status(status, stage: detail?.stage ?? summary.stage,
                                        progress: detail?.progress ?? summary.progress)
        return VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack(spacing: Theme.Space.s2) {
                ProgressView()
                Text(info.text).font(.system(size: 14, weight: .medium)).foregroundStyle(info.color)
            }
            ProgressView(value: Double(detail?.progress ?? summary.progress), total: 100)
                .tint(Theme.info)
            Text("Готовим перевод и озвучку — обычно занимает пару минут. Можно вернуться позже.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.textMuted)
        }
        .padding(Theme.Space.s5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardBackground)
    }

    private func infoCard(icon: String, tint: Color, text: String) -> some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            Image(systemName: icon).foregroundStyle(tint)
            Text(text).font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardBackground)
    }

    // MARK: Chapters

    @ViewBuilder private var chaptersSection: some View {
        if let chapters = detail?.chapters, !chapters.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.s2) {
                sectionLabel("Главы")
                VStack(spacing: 0) {
                    ForEach(Array(chapters.enumerated()), id: \.offset) { idx, ch in
                        Button { seek(to: ch.startSec) } label: {
                            HStack(alignment: .top, spacing: Theme.Space.s3) {
                                Text(PodcastFormat.time(ch.startSec))
                                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                                    .foregroundStyle(Theme.youtube)
                                    .frame(width: 58, alignment: .leading)
                                Text(ch.title)
                                    .font(.system(size: 14))
                                    .foregroundStyle(Theme.text)
                                    .multilineTextAlignment(.leading)
                                Spacer(minLength: 0)
                            }
                            .padding(.vertical, 10)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if idx < chapters.count - 1 {
                            Divider().overlay(Theme.border)
                        }
                    }
                }
                .padding(.horizontal, Theme.Space.s4)
                .frame(maxWidth: .infinity)
                .background(cardBackground)
            }
        }
    }

    // MARK: Transcript

    private var transcriptSection: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack {
                sectionLabel("Транскрипт")
                Spacer()
                Picker("", selection: $showOriginal) {
                    Text("Перевод").tag(false)
                    Text("Оригинал").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 190)
            }

            LazyVStack(alignment: .leading, spacing: Theme.Space.s3) {
                ForEach(segments) { seg in
                    let text = showOriginal ? seg.sourceText : seg.translatedText
                    if let text, !text.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Button { seek(to: Double(seg.startMs) / 1000) } label: {
                                Text(PodcastFormat.time(Double(seg.startMs) / 1000))
                                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                                    .foregroundStyle(Theme.youtube)
                            }
                            .buttonStyle(.plain)
                            Text(text)
                                .font(.system(size: 15))
                                .foregroundStyle(Theme.text)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 12, weight: .semibold))
            .textCase(.uppercase)
            .kerning(0.6)
            .foregroundStyle(Theme.textMuted)
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: Theme.Radius.xl, style: .continuous)
            .fill(Theme.surface)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.xl, style: .continuous)
                    .stroke(Theme.border, lineWidth: 1)
            )
    }

    // MARK: Data / playback

    private func load() async {
        do {
            let res = try await client.jobDetail(id: summary.id)
            detail = res.job
            segments = res.segments
            startAudioIfPossible()
        } catch {
            loadError = APIClient.friendlyMessage(error)
        }
    }

    private func startAudioIfPossible() {
        guard !didStartAudio, let d = detail, d.status == .done, let audio = d.audioURL else { return }
        didStartAudio = true
        player.onFinished = {
            Task { await store.setWatched(summary.id, watched: true) }
        }
        player.load(urlString: audio, startAt: d.lastPositionSec)
    }

    /// Seek the player (loading it first if needed) and start playing.
    private func seek(to seconds: Double) {
        startAudioIfPossible()
        player.seek(to: seconds)
        if !player.isPlaying { player.togglePlay() }
    }

    private func savePositionAndStop() {
        let pos = player.currentTime
        let id = summary.id
        if pos > 1 {
            Task { try? await APIClient().updatePlayback(id: id, positionSec: pos) }
        }
        player.teardown()
    }
}
