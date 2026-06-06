import SwiftUI

/// App home — a header plus a grid of feature tiles.
/// The lead tile (YouTube Podcasts) is a full-width hero; the rest are
/// "coming soon" placeholders that preview the roadmap.
struct HomeView: View {
    @State private var appeared = false

    private let featured = Feature.youtubePodcasts
    private let comingSoon = Feature.comingSoon
    private let columns = [
        GridItem(.flexible(), spacing: Theme.Space.s3),
        GridItem(.flexible(), spacing: Theme.Space.s3)
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s6) {
                AppearAnimator(index: 0, appeared: appeared) { header }

                AppearAnimator(index: 1, appeared: appeared) {
                    NavigationLink(value: Route.youtubePodcasts) {
                        FeatureHeroCard(feature: featured)
                    }
                    .buttonStyle(PressableStyle())
                }

                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    AppearAnimator(index: 2, appeared: appeared) {
                        sectionHeader("Скоро в приложении")
                    }
                    LazyVGrid(columns: columns, spacing: Theme.Space.s3) {
                        ForEach(Array(comingSoon.enumerated()), id: \.element.id) { idx, feature in
                            AppearAnimator(index: 3 + idx, appeared: appeared) {
                                ComingSoonCard(feature: feature)
                            }
                        }
                    }
                }

                AppearAnimator(index: 3 + comingSoon.count, appeared: appeared) { footer }
            }
            .padding(.horizontal, Theme.Space.s5)
            .padding(.top, Theme.Space.s3)
            .padding(.bottom, Theme.Space.s10)
        }
        .background(Theme.pageBackground)
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(for: Route.self) { route in
            switch route {
            case .youtubePodcasts: YouTubePodcastsView()
            }
        }
        .onAppear { appeared = true }
    }

    // MARK: - Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Привет 👋")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textMuted)
            Text("AIBooster")
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(Theme.text)
            Text("Твои AI-инструменты в одном месте")
                .font(.system(size: 15))
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 12, weight: .semibold))
            .textCase(.uppercase)
            .kerning(0.6)
            .foregroundStyle(Theme.textMuted)
    }

    private var footer: some View {
        VStack(spacing: 3) {
            Text("AIBooster · v0.1")
            Text(AppConfig.apiBaseURL.host ?? AppConfig.apiBaseURL.absoluteString)
        }
        .font(.system(size: 11, design: .monospaced))
        .foregroundStyle(Theme.textMuted)
        .frame(maxWidth: .infinity)
        .padding(.top, Theme.Space.s4)
    }
}

// MARK: - Hero tile

/// Full-width lead feature card.
struct FeatureHeroCard: View {
    let feature: Feature

    var body: some View {
        HStack(spacing: Theme.Space.s4) {
            IconBadge(systemImage: feature.systemImage, tint: feature.tint, size: 60, animated: true)

            VStack(alignment: .leading, spacing: 5) {
                Text(feature.title)
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text(feature.subtitle)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 4) {
                    Text("Открыть")
                    Image(systemName: "arrow.right")
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(feature.tint)
                .padding(.top, 2)
            }

            Spacer(minLength: 0)
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
        .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.xl, style: .continuous))
    }
}

// MARK: - Coming-soon tile

struct ComingSoonCard: View {
    let feature: Feature

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack(alignment: .top) {
                IconBadge(systemImage: feature.systemImage, tint: feature.tint, size: 40)
                Spacer()
                Text("Скоро")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textMuted)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Theme.bgMuted))
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(feature.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text(feature.subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textMuted)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, minHeight: 138, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.lg + 2, style: .continuous)
                .fill(Theme.surface.opacity(0.72))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.lg + 2, style: .continuous)
                        .stroke(Theme.border, lineWidth: 1)
                )
        )
        .opacity(0.92)
    }
}

#Preview {
    NavigationStack { HomeView() }
        .tint(Theme.accent)
}
