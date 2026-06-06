import SwiftUI

/// One episode in the feed: thumbnail, title, live status, summary.
struct EpisodeRow: View {
    let job: API.JobSummary

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            thumbnail
            VStack(alignment: .leading, spacing: 6) {
                Text(job.title ?? "Без названия")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                statusLine

                if let summary = job.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textMuted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
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
    }

    private var thumbnail: some View {
        ZStack {
            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                .fill(Theme.bgMuted)
            AsyncImage(url: PodcastFormat.thumbnailURL(job.videoId)) { phase in
                if let image = phase.image {
                    image.resizable().aspectRatio(contentMode: .fill)
                } else {
                    Image(systemName: "play.rectangle.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(Theme.textMuted)
                }
            }
            if job.status == .done {
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 24))
                    .foregroundStyle(.white.opacity(0.95))
                    .shadow(radius: 3)
            }
        }
        .frame(width: 104, height: 66)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
    }

    @ViewBuilder private var statusLine: some View {
        let info = PodcastFormat.status(job.status, stage: job.stage, progress: job.progress)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle().fill(info.color).frame(width: 6, height: 6)
                Text(info.text)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(info.color)
                if let d = PodcastFormat.duration(job.durationSec) {
                    Text("· \(d)")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textMuted)
                }
            }
            if job.status == .running {
                ProgressView(value: Double(job.progress), total: 100)
                    .tint(Theme.info)
                    .frame(maxWidth: 160)
            }
        }
    }
}
