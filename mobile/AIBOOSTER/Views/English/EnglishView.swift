import SwiftUI

/// English dialogues: a library of generated conversations to listen to and
/// read (EN + RU). Backed by the open /api/english-dialogues routes.
struct EnglishView: View {
    @StateObject private var store = EnglishStore()
    @State private var showCreate = false
    @State private var filter: Filter = .toListen

    enum Filter: String, CaseIterable, Hashable {
        case toListen, watched, all
        var title: String {
            switch self {
            case .toListen: return "Слушать"
            case .watched:  return "Прослушано"
            case .all:      return "Все"
            }
        }
    }

    private var filtered: [API.EnglishDialogueSummary] {
        switch filter {
        case .toListen: return store.jobs.filter { $0.watchStatus == "to_watch" }
        case .watched:  return store.jobs.filter { $0.watchStatus == "watched" }
        case .all:      return store.jobs
        }
    }

    var body: some View {
        content
            .background(Theme.pageBackground)
            .navigationTitle("Английский")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showCreate = true } label: { Image(systemName: "plus") }
                }
            }
            .sheet(isPresented: $showCreate) {
                CreateDialogueSheet { topic, duration, kind, withTranslation in
                    await store.create(topic: topic, durationMin: duration, kind: kind, withTranslation: withTranslation)
                }
            }
            .task { if store.jobs.isEmpty { await store.load(initial: true) } }
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

    private var feed: some View {
        VStack(spacing: 0) {
            Picker("", selection: $filter) {
                ForEach(Filter.allCases, id: \.self) { f in Text(f.title).tag(f) }
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
                                DialogueDetailView(summary: job, store: store)
                            } label: {
                                DialogueRow(job: job)
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

    @ViewBuilder private func watchToggle(_ job: API.EnglishDialogueSummary) -> some View {
        if job.watchStatus == "watched" {
            Button { Task { await store.setWatched(job.id, watched: false) } } label: {
                Label("Вернуть в «Слушать»", systemImage: "arrow.uturn.left")
            }
        } else {
            Button { Task { await store.setWatched(job.id, watched: true) } } label: {
                Label("Отметить прослушанным", systemImage: "checkmark")
            }
        }
    }

    private var loadingState: some View {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyState: some View {
        VStack(spacing: Theme.Space.s5) {
            IconBadge(systemImage: "text.bubble.fill", tint: Theme.success, size: 64, animated: true)
            VStack(spacing: 8) {
                Text("Пока пусто")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Theme.text)
                Text("Задай тему — сгенерим диалог или монолог на английском с аудио и переводом.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button { showCreate = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus")
                    Text("Создать разговор")
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, Theme.Space.s5)
                .padding(.vertical, Theme.Space.s3)
                .background(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous).fill(Theme.accent))
            }
            .buttonStyle(PressableStyle())
        }
        .padding(Theme.Space.s8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: Theme.Space.s4) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 40)).foregroundStyle(Theme.textMuted)
            Text("Не удалось загрузить").font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.text)
            Text(message).font(.system(size: 13)).foregroundStyle(Theme.textMuted).multilineTextAlignment(.center)
            Button("Повторить") { Task { await store.load(initial: true) } }
                .buttonStyle(.borderedProminent).tint(Theme.accent)
        }
        .padding(Theme.Space.s8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    NavigationStack { EnglishView() }
        .tint(Theme.accent)
}
