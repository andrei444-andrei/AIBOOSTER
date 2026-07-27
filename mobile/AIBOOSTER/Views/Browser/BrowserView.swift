import SwiftUI

/// A URL the browser is opening. Identifiable so `fullScreenCover(item:)` can
/// present a fresh web view per navigation.
struct WebTarget: Identifiable {
    let id = UUID()
    let url: URL
}

/// Recently opened addresses, kept locally.
enum BrowserHistory {
    private static let key = "browser_recents"
    private static let limit = 8

    static func load() -> [String] {
        UserDefaults.standard.stringArray(forKey: key) ?? []
    }

    static func add(_ urlString: String) -> [String] {
        var list = load().filter { $0.caseInsensitiveCompare(urlString) != .orderedSame }
        list.insert(urlString, at: 0)
        list = Array(list.prefix(limit))
        UserDefaults.standard.set(list, forKey: key)
        return list
    }

    static func clear() -> [String] {
        UserDefaults.standard.removeObject(forKey: key)
        return []
    }
}

/// Type an address, hit "Перейти", the site opens fullscreen.
struct BrowserView: View {
    @State private var input = ""
    @State private var target: WebTarget?
    @State private var error: String?
    @State private var recents: [String] = BrowserHistory.load()
    @FocusState private var fieldFocused: Bool

    private var canGo: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                field
                goButton
                if let error {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.youtube)
                }
                if !recents.isEmpty { recentsSection }
            }
            .padding(.horizontal, Theme.Space.s5)
            .padding(.top, Theme.Space.s4)
            .padding(.bottom, Theme.Space.s10)
        }
        .background(Theme.pageBackground)
        .navigationTitle("Браузер")
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(item: $target) { t in
            FullscreenWebView(url: t.url)
        }
        .onAppear { fieldFocused = true }
    }

    // MARK: Input

    private var field: some View {
        HStack(spacing: Theme.Space.s2) {
            Image(systemName: "globe")
                .foregroundStyle(Theme.textMuted)
            TextField("example.com", text: $input)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .submitLabel(.go)
                .font(.system(size: 17))
                .focused($fieldFocused)
                .onSubmit { open() }
            if !input.isEmpty {
                Button {
                    input = ""
                    error = nil
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.textMuted)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, Theme.Space.s4)
        .padding(.vertical, Theme.Space.s3)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                .fill(Theme.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                        .stroke(Theme.border, lineWidth: 1)
                )
        )
    }

    private var goButton: some View {
        Button(action: open) {
            HStack(spacing: 6) {
                Text("Перейти")
                Image(systemName: "arrow.right")
            }
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Theme.Space.s3)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .fill(canGo ? Theme.accent : Theme.textMuted)
            )
        }
        .buttonStyle(PressableStyle())
        .disabled(!canGo)
    }

    private var recentsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack {
                Text("Недавние")
                    .font(.system(size: 12, weight: .semibold))
                    .textCase(.uppercase)
                    .kerning(0.6)
                    .foregroundStyle(Theme.textMuted)
                Spacer()
                Button("Очистить") { recents = BrowserHistory.clear() }
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.info)
            }
            ForEach(recents, id: \.self) { item in
                Button {
                    input = item
                    open()
                } label: {
                    HStack(spacing: Theme.Space.s3) {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textMuted)
                        Text(item)
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.text)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textMuted)
                    }
                    .padding(Theme.Space.s3)
                    .background(
                        RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                            .fill(Theme.surface)
                            .overlay(
                                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                    .stroke(Theme.border, lineWidth: 1)
                            )
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: Actions

    private func open() {
        let raw = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = BrowserView.normalize(raw) else {
            error = "Не похоже на адрес сайта — проверь и попробуй ещё раз."
            return
        }
        error = nil
        fieldFocused = false
        recents = BrowserHistory.add(raw)
        target = WebTarget(url: url)
    }

    /// "example.com" -> https://example.com; rejects anything without a host.
    static func normalize(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty, !s.contains(" ") else { return nil }
        if !s.contains("://") { s = "https://" + s }
        guard let url = URL(string: s),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, host.contains(".") || host == "localhost"
        else { return nil }
        return url
    }
}

/// The site, fullscreen. Only chrome: a thin load bar and a small close button.
struct FullscreenWebView: View {
    let url: URL

    @Environment(\.dismiss) private var dismiss
    @State private var progress: Double = 0
    @State private var isLoading = true

    var body: some View {
        ZStack(alignment: .top) {
            WebView(
                url: url,
                onProgress: { progress = $0 },
                onLoadingChange: { isLoading = $0 }
            )
            .ignoresSafeArea()

            if isLoading && progress < 1 {
                ProgressView(value: progress)
                    .progressViewStyle(.linear)
                    .tint(Theme.info)
            }
        }
        .overlay(alignment: .topLeading) {
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .frame(width: 36, height: 36)
                    .background(.ultraThinMaterial, in: Circle())
                    .overlay(Circle().stroke(Theme.border, lineWidth: 1))
            }
            .padding(.leading, Theme.Space.s3)
            .padding(.top, Theme.Space.s2)
        }
        .statusBarHidden(true)
    }
}

#Preview {
    NavigationStack { BrowserView() }
        .tint(Theme.accent)
}
