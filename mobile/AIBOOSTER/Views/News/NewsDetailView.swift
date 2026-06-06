import SwiftUI

/// Full news item: header, "why useful", the AI deep-dive (or the raw post
/// while it's still being synthesized), sources, and feedback that marks it read.
struct NewsDetailView: View {
    let item: API.NewsItem
    let store: NewsStore

    @Environment(\.dismiss) private var dismiss
    @State private var enrichment: API.NewsEnrichment?
    @State private var sending = false
    @State private var actionError: String?

    private let client = APIClient()
    private var enr: API.NewsEnrichment? { enrichment ?? item.enrichment }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s5) {
                header
                if let v = item.valueExplanation, !v.isEmpty { valueCard(v) }
                articleSection
                feedbackBar
            }
            .padding(.horizontal, Theme.Space.s5)
            .padding(.vertical, Theme.Space.s4)
        }
        .background(Theme.pageBackground)
        .navigationTitle("Новость")
        .navigationBarTitleDisplayMode(.inline)
        .task { await refreshEnrichment() }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack(spacing: 6) {
                Text(item.source.name)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.info)
                if let rel = NewsFormat.relative(item.publishedAt) {
                    Text("· \(rel)").font(.system(size: 13)).foregroundStyle(Theme.textMuted)
                }
            }
            Text(item.title ?? "Без заголовка")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            if let urlString = item.url, let url = URL(string: urlString) {
                Link(destination: url) {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.up.right.square")
                        Text("Открыть оригинал")
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.info)
                }
            }
        }
    }

    private func valueCard(_ text: String) -> some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            Image(systemName: "lightbulb.fill").foregroundStyle(Theme.warning)
            Text(text)
                .font(.system(size: 15))
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .fill(Theme.warning.opacity(0.12))
        )
    }

    // MARK: Article / enrichment

    @ViewBuilder private var articleSection: some View {
        if let e = enr, e.status == "done", let body = e.articleBody, !body.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Space.s5) {
                article(body)
                if let facts = e.keyFacts, !facts.isEmpty { keyFacts(facts) }
                if let imgs = e.images, !imgs.isEmpty { imagesView(imgs) }
                if let srcs = e.sourcesUsed, !srcs.isEmpty { sourcesView(srcs) }
            }
        } else {
            VStack(alignment: .leading, spacing: Theme.Space.s3) {
                if let body = item.body ?? item.summary, !body.isEmpty {
                    article(body)
                }
                enrichNote
            }
        }
    }

    @ViewBuilder private var enrichNote: some View {
        let status = enr?.status
        if status == "failed" {
            label("Авто-разбор недоступен для этой новости.", system: "exclamationmark.circle")
        } else if status == nil || status == "pending" || status == "running" {
            HStack(spacing: Theme.Space.s2) {
                ProgressView()
                Text("Готовим глубокий разбор — загляни чуть позже.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textMuted)
            }
            .padding(.top, Theme.Space.s2)
        }
    }

    private func article(_ body: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            ForEach(Array(NewsFormat.paragraphs(body).enumerated()), id: \.offset) { _, p in
                Text(NewsFormat.markdown(p))
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func keyFacts(_ facts: [String]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            sectionLabel("Ключевое")
            ForEach(Array(facts.enumerated()), id: \.offset) { _, f in
                HStack(alignment: .top, spacing: 8) {
                    Circle().fill(Theme.info).frame(width: 6, height: 6).padding(.top, 7)
                    Text(NewsFormat.markdown(f))
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardBackground)
    }

    private func imagesView(_ imgs: [API.NewsImage]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            ForEach(imgs) { img in
                VStack(alignment: .leading, spacing: 4) {
                    AsyncImage(url: URL(string: img.url)) { phase in
                        if let image = phase.image {
                            image.resizable().aspectRatio(contentMode: .fit)
                        } else {
                            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                .fill(Theme.bgMuted)
                                .frame(height: 160)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
                    if let c = img.caption, !c.isEmpty {
                        Text(c).font(.system(size: 12)).foregroundStyle(Theme.textMuted)
                    }
                }
            }
        }
    }

    private func sourcesView(_ srcs: [API.NewsSourceUsed]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            sectionLabel("Источники")
            ForEach(srcs) { s in
                if let u = URL(string: s.url) {
                    Link(destination: u) {
                        HStack(alignment: .top, spacing: 6) {
                            Image(systemName: "link").font(.system(size: 11)).padding(.top, 3)
                            Text(s.title ?? s.url)
                                .font(.system(size: 14))
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                        }
                        .foregroundStyle(Theme.info)
                    }
                }
            }
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardBackground)
    }

    // MARK: Feedback

    private var feedbackBar: some View {
        VStack(spacing: Theme.Space.s2) {
            HStack(spacing: Theme.Space.s3) {
                feedbackButton("Нравится", system: "hand.thumbsup.fill", tint: Theme.success, signal: "like")
                feedbackButton("Не то", system: "hand.thumbsdown.fill", tint: Theme.textMuted, signal: "dislike")
                feedbackButton("Скрыть", system: "eye.slash.fill", tint: Theme.youtube, signal: "hide")
            }
            if let actionError {
                Text(actionError).font(.system(size: 12)).foregroundStyle(Theme.youtube)
            }
        }
        .padding(.top, Theme.Space.s2)
    }

    private func feedbackButton(_ title: String, system: String, tint: Color, signal: String) -> some View {
        Button { react(signal) } label: {
            VStack(spacing: 4) {
                Image(systemName: system).font(.system(size: 18))
                Text(title).font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Theme.Space.s3)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .fill(Theme.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                            .stroke(Theme.border, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(PressableStyle())
        .disabled(sending)
    }

    // MARK: Bits

    private func sectionLabel(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 12, weight: .semibold))
            .textCase(.uppercase)
            .kerning(0.6)
            .foregroundStyle(Theme.textMuted)
    }

    private func label(_ text: String, system: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: system)
            Text(text).font(.system(size: 13))
            Spacer(minLength: 0)
        }
        .foregroundStyle(Theme.textMuted)
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
            .fill(Theme.surface)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .stroke(Theme.border, lineWidth: 1)
            )
    }

    // MARK: Actions

    private func refreshEnrichment() async {
        if let e = try? await client.newsEnrichment(itemId: item.id) {
            enrichment = e
        }
    }

    private func react(_ signal: String) {
        guard !sending else { return }
        sending = true
        actionError = nil
        Task {
            let err = await store.sendFeedback(itemId: item.id, signal: signal)
            sending = false
            if let err {
                actionError = err
            } else {
                dismiss()
            }
        }
    }
}
