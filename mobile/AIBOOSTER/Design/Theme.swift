import SwiftUI

// MARK: - Design tokens
// Mirror of the web UX Kit (app/globals.css / lib/design-tokens.ts).
// Warm cream palette, near-black monochrome accent, hairline borders.
// Keep these values in sync with the web tokens by hand.

enum Theme {
    // Surfaces
    static let bg        = Color(hex: 0xFAF9F5)
    static let bgSubtle  = Color(hex: 0xF1EFE8)
    static let bgMuted   = Color(hex: 0xEAE7DC)
    static let surface   = Color(hex: 0xFFFFFF)

    // Text
    static let text          = Color(hex: 0x1F1F1E)
    static let textSecondary = Color(hex: 0x5F5E5A)
    static let textMuted     = Color(hex: 0x888780)

    // Lines & accent
    static let border       = Color.black.opacity(0.08)
    static let borderStrong = Color.black.opacity(0.15)
    static let accent       = Color(hex: 0x1F1F1E)

    // Feature brand tints (icon badges)
    static let youtube = Color(hex: 0xFF0033)
    static let info    = Color(hex: 0x185FA5)
    static let success = Color(hex: 0x3B6D11)
    static let warning = Color(hex: 0x854F0B)

    enum Radius {
        static let sm: CGFloat = 6
        static let md: CGFloat = 10
        static let lg: CGFloat = 14
        static let xl: CGFloat = 22   // feature tiles
    }

    enum Space {
        static let s1: CGFloat = 4
        static let s2: CGFloat = 8
        static let s3: CGFloat = 12
        static let s4: CGFloat = 16
        static let s5: CGFloat = 20
        static let s6: CGFloat = 24
        static let s8: CGFloat = 32
        static let s10: CGFloat = 40
    }

    /// Shared page background — subtle warm vertical gradient.
    static var pageBackground: some View {
        LinearGradient(
            colors: [bg, bgSubtle],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }
}

extension Color {
    /// 0xRRGGBB literal initializer.
    init(hex: UInt, alpha: Double = 1) {
        self.init(
            .sRGB,
            red:   Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue:  Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}
