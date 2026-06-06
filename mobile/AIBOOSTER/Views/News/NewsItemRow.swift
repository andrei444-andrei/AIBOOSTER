import SwiftUI

/// One news card: source + date, title, "why useful", matched topics.
struct NewsItemRow: View {
    let item: API.NewsItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(item.source.name)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.info)
                    .lineLimit(1)
                if let rel = NewsFormat.relative(item.publishedAt) {
                    Text("· \(rel)")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textMuted)
                }
                Spacer(minLength: 0)
                if item.enrichment?.status == "done" {
                    Image(systemName: "sparkles")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.warning)
                }
            }

            Text(item.title ?? "Без заголовка")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.text)
                .lineLimit(3)
                .multilineTextAlignment(.leading)

            if let v = item.valueExplanation, !v.isEmpty {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "lightbulb.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.warning)
                        .padding(.top, 2)
                    Text(v)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                }
            } else if let s = item.summary, !s.isEmpty {
                Text(s)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
            }

            if let topics = item.matchedTopics, !topics.isEmpty {
                HStack(spacing: 6) {
                    ForEach(topics.prefix(3), id: \.self) { t in
                        Text(t)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Theme.textMuted)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(Theme.bgMuted))
                    }
                }
            }
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
}
