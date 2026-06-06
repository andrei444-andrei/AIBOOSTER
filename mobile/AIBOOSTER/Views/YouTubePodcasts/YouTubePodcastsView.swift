import SwiftUI

/// First-cut screen for the YouTube Podcasts feature.
///
/// Layout-only for now: a hero explaining the feature plus a skeleton feed
/// that previews the episode list. The data layer is intentionally not wired
/// yet — per §11 the API contract is fixed in `lib/api-types.ts` on `main`
/// first, then web + mobile implement it. See `Models/API.swift`.
struct YouTubePodcastsView: View {
    @State private var skeletonPulse = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s5) {
                heroCard
                sectionHeader("Лента")
                VStack(spacing: Theme.Space.s3) {
                    ForEach(0..<4, id: \.self) { _ in
                        SkeletonRow(pulse: skeletonPulse)
                    }
                }
                note
            }
            .padding(.horizontal, Theme.Space.s5)
            .padding(.top, Theme.Space.s4)
            .padding(.bottom, Theme.Space.s10)
        }
        .background(Theme.pageBackground)
        .navigationTitle("YouTube Podcasts")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { skeletonPulse = true }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4) {
            HStack(spacing: Theme.Space.s4) {
                IconBadge(systemImage: "play.fill", tint: Theme.youtube, size: 56, animated: true)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Видео-подкасты, на твоём языке")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Theme.text)
                    Text("Вставь ссылку на видео или плейлист — получишь перевод, транскрипт и аудио для прослушивания в фоне.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            // Inert for now — enabled once the API contract lands.
            Button {
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus")
                    Text("Добавить подкаст")
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Theme.Space.s3)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                        .fill(Theme.accent)
                )
            }
            .buttonStyle(PressableStyle())
            .disabled(true)
            .opacity(0.55)
        }
        .padding(Theme.Space.s5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.xl, style: .continuous)
                .fill(Theme.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.xl, style: .continuous)
                        .stroke(Theme.border, lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.07), radius: 18, y: 9)
        )
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 12, weight: .semibold))
            .textCase(.uppercase)
            .kerning(0.6)
            .foregroundStyle(Theme.textMuted)
    }

    private var note: some View {
        HStack(spacing: Theme.Space.s2) {
            Image(systemName: "info.circle")
            Text("Лента подключится к API на следующем шаге.")
        }
        .font(.system(size: 12))
        .foregroundStyle(Theme.textMuted)
        .padding(.top, Theme.Space.s2)
    }
}

/// Loading-state placeholder row — breathes to read as "loading".
private struct SkeletonRow: View {
    let pulse: Bool

    var body: some View {
        HStack(spacing: Theme.Space.s3) {
            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                .fill(Theme.bgMuted)
                .frame(width: 104, height: 64)

            VStack(alignment: .leading, spacing: 8) {
                bar(width: nil, height: 12)
                bar(width: 150, height: 12)
                bar(width: 84, height: 10)
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
        .animation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true), value: pulse)
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
