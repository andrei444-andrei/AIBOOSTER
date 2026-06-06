import SwiftUI

// MARK: - Shared UI primitives for the mobile UX Kit.

/// Rounded gradient badge holding an SF Symbol. Used by feature tiles.
struct IconBadge: View {
    let systemImage: String
    let tint: Color
    var size: CGFloat = 56
    /// When true the badge gains a slow breathing glow + symbol pulse.
    var animated: Bool = false

    @State private var breathing = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.30, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [tint.opacity(0.95), tint.opacity(0.72)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .shadow(color: tint.opacity(0.35), radius: breathing ? 16 : 9, y: 5)

            Image(systemName: systemImage)
                .font(.system(size: size * 0.42, weight: .bold))
                .foregroundStyle(.white)
                .symbolEffect(.pulse, options: .repeating, isActive: animated)
        }
        .frame(width: size, height: size)
        .scaleEffect(breathing ? 1.035 : 1)
        .onAppear {
            guard animated else { return }
            withAnimation(.easeInOut(duration: 1.9).repeatForever(autoreverses: true)) {
                breathing = true
            }
        }
    }
}

/// Press-feedback button style: gentle scale-down while held.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.30, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// Staggered entrance: fade + rise + slight scale, delayed by `index`.
struct AppearAnimator<Content: View>: View {
    let index: Int
    let appeared: Bool
    let content: Content

    init(index: Int, appeared: Bool, @ViewBuilder content: () -> Content) {
        self.index = index
        self.appeared = appeared
        self.content = content()
    }

    var body: some View {
        content
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 18)
            .scaleEffect(appeared ? 1 : 0.97, anchor: .center)
            .animation(
                .spring(response: 0.55, dampingFraction: 0.85)
                    .delay(Double(index) * 0.07),
                value: appeared
            )
    }
}
