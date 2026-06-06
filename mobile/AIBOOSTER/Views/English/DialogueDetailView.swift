import SwiftUI

/// One dialogue: header, audio player (when ready) or processing/error, and a
/// bilingual transcript (EN + optional RU) with speaker labels.
struct DialogueDetailView: View {
    let summary: API.EnglishDialogueSummary
    let store: EnglishStore

    @StateObject private var player = AudioPlayer()
    @State private var detail: API.EnglishDialogueDetail?
    @State private var segments: [API.EnglishSegment] = []
    @State private var showTranslation: Bool
    @State private var didStartAudio = false
    @State private var watchedOverride: Bool?

    private let client = APIClient()

    init(summary: API.EnglishDialogueSummary, store: EnglishStore) {
        self.summary = summary
        self.store = store
        _showTranslation = State(initialValue: summary.withTranslation != 0)
    }

    private var status: String { detail?.status ?? summary.status }
    private var audioURL: String? { detail?.audioURL ?? summary.audioURL }
    private var hasTranslation: Bool {
        segments.contains { ($0.ruText?.isEmpty == false) }
    }
    private var isWatched: Bool {
        watchedOverride ?? ((detail?.watchStatus ?? summary.watchStatus) == "watched")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s5) {
                header
                statusSection
                if !segments.isEmpty { transcriptSection }
            }
            .padding(.horizontal, Theme.Space.s5)
            .padding(.vertical, Theme.Space.s4)
        }
        .background(Theme.pageBackground)
        .navigationTitle(summary.title ?? "Разговор")
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
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack(spacing: 6) {
                Text(EnglishFormat.kindLabel(summary.kind))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.success)
                Text("· \(summary.durationMin) мин")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textMuted)
            }
            Text(summary.title ?? summary.topic)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            if summary.title != nil {
                Text(summary.topic)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: Player / status

    @ViewBuilder private var statusSection: some View {
        if let audio = audioURL, status == "done" {
            playerCard(audio: audio)
        } else if status == "error" {
            infoCard(icon: "exclamationmark.triangle.fill", tint: Theme.youtube,
                     text: detail?.errorMessage ?? "Не удалось сгенерировать разговор.")
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
            .tint(Theme.success)

            HStack {
                Text(PodcastFormat.time(player.currentTime))
                Spacer()
                Text(player.duration > 0 ? PodcastFormat.time(player.duration) : "—:—")
            }
            .font(.system(size: 12, design: .monospaced))
            .foregroundStyle(Theme.textMuted)

            HStack(spacing: Theme.Space.s8) {
                Button { player.skip(by: -5) } label: {
                    Image(systemName: "gobackward.5").font(.system(size: 24))
                }
                Button { player.togglePlay() } label: {
                    Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 58))
                }
                Button { player.skip(by: 15) } label: {
                    Image(systemName: "goforward.15").font(.system(size: 24))
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
        let info = EnglishFormat.status(status, stage: detail?.stage ?? summary.stage,
                                        progress: detail?.progress ?? summary.progress)
        return VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack(spacing: Theme.Space.s2) {
                ProgressView()
                Text(info.text).font(.system(size: 14, weight: .medium)).foregroundStyle(info.color)
            }
            ProgressView(value: Double(detail?.progress ?? summary.progress), total: 100)
                .tint(Theme.info)
            Text("Пишем сценарий и озвучиваем — обычно меньше минуты. Можно вернуться позже.")
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

    // MARK: Transcript

    private var transcriptSection: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack {
                sectionLabel("Транскрипт")
                Spacer()
                if hasTranslation {
                    Toggle("Перевод", isOn: $showTranslation)
                        .toggleStyle(.button)
                        .font(.system(size: 13))
                        .tint(Theme.info)
                }
            }

            LazyVStack(alignment: .leading, spacing: Theme.Space.s4) {
                ForEach(segments) { seg in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            if let speaker = seg.speaker, !speaker.isEmpty {
                                Text(speaker)
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(Theme.success)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 2)
                                    .background(Capsule().fill(Theme.success.opacity(0.12)))
                            }
                            Spacer(minLength: 0)
                            Button { seek(to: Double(seg.startMs) / 1000) } label: {
                                Text(PodcastFormat.time(Double(seg.startMs) / 1000))
                                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                                    .foregroundStyle(Theme.textMuted)
                            }
                            .buttonStyle(.plain)
                        }
                        Text(seg.enText)
                            .font(.system(size: 16))
                            .foregroundStyle(Theme.text)
                            .fixedSize(horizontal: false, vertical: true)
                        if showTranslation, let ru = seg.ruText, !ru.isEmpty {
                            Text(ru)
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
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
        if let res = try? await client.dialogueDetail(id: summary.id) {
            detail = res.job
            segments = res.segments
            startAudioIfPossible()
        }
    }

    private func startAudioIfPossible() {
        guard !didStartAudio, let d = detail, d.status == "done", let audio = d.audioURL else { return }
        didStartAudio = true
        player.onFinished = {
            Task { await store.setWatched(summary.id, watched: true) }
        }
        player.load(urlString: audio, startAt: d.lastPositionSec)
    }

    private func seek(to seconds: Double) {
        startAudioIfPossible()
        player.seek(to: seconds)
        if !player.isPlaying { player.togglePlay() }
    }

    private func savePositionAndStop() {
        let pos = player.currentTime
        let id = summary.id
        if pos > 1 {
            Task { try? await APIClient().updateDialoguePlayback(id: id, positionSec: pos) }
        }
        player.teardown()
    }
}
