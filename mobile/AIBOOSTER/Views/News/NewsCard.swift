import SwiftUI

/// A news item rendered as an expandable card: collapsed shows the title and a
/// snippet of the article; tapping the spoiler reveals the full article text
/// inline (no navigation). The "why useful" line is intentionally not shown.
struct NewsCard: View {
    let item: API.NewsItem
    let showFeedback: Bool
    let store: NewsStore

    @State private var expanded = false
    @State private var enrichment: API.NewsEnrichment?
    @State private var sending = false
    @State private var actionError: String?

    private var enr: API.NewsEnrichment? { enrichment ?? item.enrichment }

    private var articleBody: String? {
        if let b = enr?.articleBody, !b.isEmpty { return b }
        return nil
    }

    /// Best available text: full article, else raw post body, else summary.
    private var fullText: String {
        articleBody ?? item.body ?? item.summary ?? ""
    }

    private var snippet: String {
        NewsFormat.paragraphs(fullText).first ?? fullText
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            header
            title

            if expanded {
                expandedBody
            } else if !snippet.isEmpty {
                Text(snippet)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
            }

            spoilerButton
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .fill(Theme.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                        .stroke(Theme.border, lineWidth: 1)
                )
        )
    }

    // MARK: Pieces

    private var header: some View {
        HStack(spacing: 6) {
            Text(item.source.name)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.info)
                .lineLimit(1)
            if let rel = NewsFormat.relative(item.publishedAt) {
                Text("· \(rel)").font(.system(size: 12)).foregroundStyle(Theme.textMuted)
            }
            Spacer(minLength: 0)
        }
    }

    private var title: some View {
        Text(item.title ?? "Без заголовка")
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Theme.text)
            .fixedSize(horizontal: false, vertical: true)
            .multilineTextAlignment(.leading)
    }

    @ViewBuilder private var expandedBody: some View {
        if let body = articleBody {
            MarkdownView(text: body)
        } else if !fullText.isEmpty {
            Text(fullText)
                .font(.system(size: 16))
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
        }

        if enr?.status != "done" {
            HStack(spacing: 6) {
                ProgressView()
                Text("Готовим полный текст — загляни чуть позже.")
                    .font(.system(size: 12)).foregroundStyle(Theme.textMuted)
            }
            .padding(.top, 2)
        }

        if let facts = enr?.keyFacts, !facts.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(facts.enumerated()), id: \.offset) { _, f in
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(Theme.info).frame(width: 5, height: 5).padding(.top, 7)
                        Text(NewsFormat.markdown(f)).font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                }
            }
            .padding(.top, 4)
        }

        if let urlString = item.url, let url = URL(string: urlString) {
            Link(destination: url) {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.up.right.square")
                    Text("Открыть оригинал")
                }
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.info)
            }
            .padding(.top, 2)
        }

        if showFeedback { feedbackBar }
    }

    private var spoilerButton: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
            if expanded { Task { await loadEnrichmentIfNeeded() } }
        } label: {
            HStack(spacing: 4) {
                Text(expanded ? "Свернуть" : "Читать полностью")
                Image(systemName: expanded ? "chevron.up" : "chevron.down")
            }
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.info)
        }
        .buttonStyle(.plain)
    }

    private var feedbackBar: some View {
        VStack(spacing: Theme.Space.s2) {
            Divider().overlay(Theme.border)
            HStack(spacing: Theme.Space.s3) {
                button("Нравится", system: "hand.thumbsup", tint: Theme.success, signal: "like")
                button("Не то", system: "hand.thumbsdown", tint: Theme.textMuted, signal: "dislike")
                button("Скрыть", system: "eye.slash", tint: Theme.youtube, signal: "hide")
            }
            if let actionError {
                Text(actionError).font(.system(size: 12)).foregroundStyle(Theme.youtube)
            }
        }
        .padding(.top, 4)
    }

    private func button(_ titleText: String, system: String, tint: Color, signal: String) -> some View {
        Button { react(signal) } label: {
            VStack(spacing: 3) {
                Image(systemName: system).font(.system(size: 16))
                Text(titleText).font(.system(size: 11, weight: .medium))
            }
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Theme.Space.s2)
        }
        .buttonStyle(.plain)
        .disabled(sending)
    }

    // MARK: Actions

    private func loadEnrichmentIfNeeded() async {
        guard enr?.status != "done" || articleBody == nil else { return }
        if let fresh = try? await APIClient().newsEnrichment(itemId: item.id) {
            enrichment = fresh
        }
    }

    private func react(_ signal: String) {
        guard !sending else { return }
        sending = true
        actionError = nil
        Task {
            let err = await store.sendFeedback(itemId: item.id, signal: signal)
            sending = false
            if let err { actionError = err }
            // On success the item leaves the feed (store removes it).
        }
    }
}
