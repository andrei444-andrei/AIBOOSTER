import SwiftUI

/// YouTube Podcasts feature: a live feed of translated episodes backed by the
/// existing /api/jobs endpoints. Tap an episode to listen + read the
/// transcript; "+" submits a new YouTube URL.
struct YouTubePodcastsView: View {
    @StateObject private var store = PodcastsStore()
    @State private var showAdd = false
    @State private var filter: Filter = .toListen

    enum Filter: String, CaseIterable, Hashable {
        case toListen, watched, all
        var title: String {
            switch self {
            case .toListen: return "Слушать"
            case .watched: return "Прослушано"
            case .all: return "Все"
            }
        }
    }

    private var filtered: [API.JobSummary] {
        switch filter {
        case .toListen: return store.jobs.filter { $0.watchStatus == .toWatch }
        case .watched:  return store.jobs.filter { $0.watchStatus == .watched }
        case .all:      return store.jobs
        }
    }

    var body: some View {
        content
            .background(Theme.pageBackground)
            .navigationTitle("YouTube Podcasts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showAdd = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showAdd) {
                AddPodcastSheet { url, lang, quality in
                    await store.submit(url: url, lang: lang, quality: quality)
                }
            }
            .task {
                if store.jobs.isEmpty { await store.load(initial: true) }
            }
    }

    @ViewBuilder private var content: some View {
        if store.jobs.isEmpty {
            switch store.phase {
            case .idle, .loading:
                loadingState
            case .failed(let message):
                errorState(message)
            case .loaded:
                emptyState
            }
        } else {
            feed
        }
    }

    // MARK: Feed

    private var feed: some View {
        VStack(spacing: 0) {
            Picker("", selection: $filter) {
                ForEach(Filter.allCases, id: \.self) { f in
                    Text(f.title).tag(f)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, Theme.Space.s5)
            .padding(.top, Theme.Space.s2)
            .padding(.bottom, Theme.Space.s3)

            ScrollView {
                LazyVStack(spacing: Theme.Space.s3) {
                    if filtered.isEmpty {
                        Text(filter == .watched ? "Пока ничего не прослушано" : "Здесь пусто")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textMuted)
                            .frame(maxWidth: .infinity)
                            .padding(.top, Theme.Space.s10)
                    } else {
                        ForEach(filtered) { job in
                            NavigationLink {
                                EpisodeDetailView(summary: job, store: store)
                            } label: {
                                EpisodeRow(job: job)
                            }
                            .buttonStyle(.plain)
                            .contextMenu { watchToggle(job) }
                        }
                    }
                }
                .padding(.horizontal, Theme.Space.s5)
                .padding(.bottom, Theme.Space.s10)
            }
            .refreshable { await store.load() }
        }
    }

    @ViewBuilder private func watchToggle(_ job: API.JobSummary) -> some View {
        if job.watchStatus == .watched {
            Button { Task { await store.setWatched(job.id, watched: false) } } label: {
                Label("Вернуть в «Слушать»", systemImage: "arrow.uturn.left")
            }
        } else {
            Button { Task { await store.setWatched(job.id, watched: true) } } label: {
                Label("Отметить прослушанным", systemImage: "checkmark")
            }
        }
    }

    // MARK: States

    private var loadingState: some View {
        ScrollView {
            VStack(spacing: Theme.Space.s3) {
                ForEach(0..<5, id: \.self) { _ in SkeletonRow() }
            }
            .padding(.horizontal, Theme.Space.s5)
            .padding(.top, Theme.Space.s3)
        }
    }

    private var emptyState: some View {
        VStack(spacing: Theme.Space.s5) {
            IconBadge(systemImage: "play.fill", tint: Theme.youtube, size: 64, animated: true)
            VStack(spacing: 8) {
                Text("Пока пусто")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Theme.text)
                Text("Вставь ссылку на видео или плейлист — получишь перевод, транскрипт и аудио для прослушивания.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button { showAdd = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus")
                    Text("Добавить подкаст")
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, Theme.Space.s5)
                .padding(.vertical, Theme.Space.s3)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                        .fill(Theme.accent)
                )
            }
            .buttonStyle(PressableStyle())
        }
        .padding(Theme.Space.s8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: Theme.Space.s4) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 40))
                .foregroundStyle(Theme.textMuted)
            Text("Не удалось загрузить ленту")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.text)
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(Theme.textMuted)
                .multilineTextAlignment(.center)
            Button("Повторить") { Task { await store.load(initial: true) } }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
        }
        .padding(Theme.Space.s8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Loading placeholder row — breathes to read as "loading".
private struct SkeletonRow: View {
    @State private var pulse = false

    var body: some View {
        HStack(spacing: Theme.Space.s3) {
            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                .fill(Theme.bgMuted)
                .frame(width: 104, height: 66)
            VStack(alignment: .leading, spacing: 8) {
                bar(width: nil, height: 12)
                bar(width: 150, height: 12)
                bar(width: 90, height: 10)
            }
            Spacer(minLength: 0)
        }
        .padding(Theme.Space.s3)
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
    NavigationStack { YouTubePodcastsView() }
        .tint(Theme.accent)
}
