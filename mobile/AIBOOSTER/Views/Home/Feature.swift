import SwiftUI

/// A feature tile shown on the home screen.
struct Feature: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let systemImage: String
    let tint: Color
    /// Available features navigate to `route`; coming-soon ones are inert.
    let route: Route?

    var isAvailable: Bool { route != nil }
}

/// Navigation targets pushed onto the home `NavigationStack`.
enum Route: Hashable {
    case youtubePodcasts
}

extension Feature {
    /// The lead feature — first real screen of the app.
    static let youtubePodcasts = Feature(
        id: "youtube-podcasts",
        title: "YouTube Podcasts",
        subtitle: "Переводы видео-подкастов — слушай и читай на своём языке",
        systemImage: "play.fill",
        tint: Theme.youtube,
        route: .youtubePodcasts
    )

    /// Roadmap tiles — mirror real web features, shown as “coming soon”.
    static let comingSoon: [Feature] = [
        Feature(
            id: "news",
            title: "Новости",
            subtitle: "Персональная лента с AI-разбором",
            systemImage: "newspaper.fill",
            tint: Theme.info,
            route: nil
        ),
        Feature(
            id: "chat",
            title: "Чат",
            subtitle: "Ансамбль моделей в одном диалоге",
            systemImage: "bubble.left.and.bubble.right.fill",
            tint: Theme.accent,
            route: nil
        ),
        Feature(
            id: "research",
            title: "Исследования",
            subtitle: "Глубокий поиск по теме",
            systemImage: "binoculars.fill",
            tint: Theme.success,
            route: nil
        ),
        Feature(
            id: "video-translate",
            title: "Перевод видео",
            subtitle: "Озвучка и субтитры на лету",
            systemImage: "character.bubble.fill",
            tint: Theme.warning,
            route: nil
        )
    ]
}
