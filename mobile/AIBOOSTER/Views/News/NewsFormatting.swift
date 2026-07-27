import SwiftUI

/// Shared helpers for the news screens.
enum NewsFormat {
    private static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let iso = ISO8601DateFormatter()

    static func date(_ s: String?) -> Date? {
        guard let s else { return nil }
        return isoFrac.date(from: s) ?? iso.date(from: s)
    }

    /// "2 дн. назад" style; falls back to nil if unparseable.
    static func relative(_ s: String?) -> String? {
        guard let d = date(s) else { return nil }
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: "ru_RU")
        f.unitsStyle = .short
        return f.localizedString(for: d, relativeTo: Date())
    }

    /// Split article markdown into paragraphs for rendering.
    static func paragraphs(_ text: String) -> [String] {
        text
            .components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    /// Strip markdown markers (#, -, *, **, `, >) and links/images, then
    /// collapse whitespace into a clean plain-text paragraph for the preview.
    static func plainText(_ markdown: String) -> String {
        var text = markdown
        // ![alt](url) -> drop, [text](url) -> text
        text = text.replacingOccurrences(
            of: "!\\[[^\\]]*\\]\\([^)]*\\)", with: "", options: .regularExpression)
        text = text.replacingOccurrences(
            of: "\\[([^\\]]+)\\]\\([^)]*\\)", with: "$1", options: .regularExpression)
        return text
            .components(separatedBy: "\n")
            .map { line -> String in
                var s = line.trimmingCharacters(in: .whitespaces)
                while s.hasPrefix("#") { s.removeFirst() }
                if s.hasPrefix("- ") || s.hasPrefix("* ") || s.hasPrefix("> ") { s = String(s.dropFirst(2)) }
                return s
            }
            .joined(separator: " ")
            .replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "`", with: "")
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    /// Inline-markdown AttributedString (bold/italic/links), plain on failure.
    static func markdown(_ s: String) -> AttributedString {
        (try? AttributedString(
            markdown: s,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(s)
    }
}
