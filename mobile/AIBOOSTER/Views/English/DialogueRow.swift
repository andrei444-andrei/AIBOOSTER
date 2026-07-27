import SwiftUI

/// One dialogue in the library: kind badge, title/topic, status.
struct DialogueRow: View {
    let job: API.EnglishDialogueSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(EnglishFormat.kindLabel(job.kind))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.success)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Theme.success.opacity(0.12)))
                if job.withTranslation != 0 {
                    Text("RU")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.info)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Theme.info.opacity(0.12)))
                }
                Spacer(minLength: 0)
                if let d = job.durationSec, d > 0 {
                    Text(PodcastFormat.time(d))
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(Theme.textMuted)
                }
            }

            Text(job.title ?? job.topic)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.text)
                .lineLimit(2)
                .multilineTextAlignment(.leading)

            if job.title != nil {
                Text(job.topic)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textMuted)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }

            statusLine
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

    @ViewBuilder private var statusLine: some View {
        let info = EnglishFormat.status(job.status, stage: job.stage, progress: job.progress)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle().fill(info.color).frame(width: 6, height: 6)
                Text(info.text)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(info.color)
            }
            if job.status == "running" {
                ProgressView(value: Double(job.progress), total: 100)
                    .tint(Theme.info)
                    .frame(maxWidth: 160)
            }
        }
    }
}
