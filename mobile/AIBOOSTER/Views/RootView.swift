import SwiftUI

struct RootView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
            Text("AIBooster")
                .font(.largeTitle.bold())
            Text("iOS-клиент")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text("API: \(AppConfig.apiBaseURL.absoluteString)")
                .font(.caption2.monospaced())
                .foregroundStyle(.tertiary)
                .padding(.top, 24)
        }
        .padding()
    }
}

#Preview {
    RootView()
}
