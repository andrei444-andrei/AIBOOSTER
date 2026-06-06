import SwiftUI

/// Root of the app — hosts the home screen in a navigation stack.
struct RootView: View {
    var body: some View {
        NavigationStack {
            HomeView()
        }
        .tint(Theme.accent)
    }
}

#Preview {
    RootView()
}
