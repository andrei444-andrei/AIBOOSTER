import SwiftUI

/// Lightweight block-markdown renderer: headings (#/##/###), bullet lists,
/// and paragraphs with inline styling (bold/italic/links). Enough for the
/// synthesized news articles — SwiftUI's Text only does inline markdown, so
/// `###`-style headings would otherwise show up as literal text.
struct MarkdownView: View {
    let text: String
    var bodyFont: CGFloat = 16

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(Self.parse(text).enumerated()), id: \.offset) { _, block in
                view(for: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func view(for block: Block) -> some View {
        switch block {
        case .heading(let level, let s):
            Text(NewsFormat.markdown(s))
                .font(.system(size: level <= 1 ? 21 : (level == 2 ? 18 : 16), weight: .bold))
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
        case .bullet(let s):
            HStack(alignment: .top, spacing: 8) {
                Text("•").foregroundStyle(Theme.textMuted)
                Text(NewsFormat.markdown(s))
                    .font(.system(size: bodyFont))
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
        case .paragraph(let s):
            Text(NewsFormat.markdown(s))
                .font(.system(size: bodyFont))
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    enum Block {
        case heading(Int, String)
        case bullet(String)
        case paragraph(String)
    }

    static func parse(_ text: String) -> [Block] {
        var blocks: [Block] = []
        var paragraph: [String] = []

        func flush() {
            if !paragraph.isEmpty {
                blocks.append(.paragraph(paragraph.joined(separator: " ")))
                paragraph = []
            }
        }

        for rawLine in text.components(separatedBy: "\n") {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { flush(); continue }
            if let h = headingMatch(line) { flush(); blocks.append(.heading(h.level, h.text)); continue }
            if let b = bulletMatch(line) { flush(); blocks.append(.bullet(b)); continue }
            paragraph.append(line)
        }
        flush()
        return blocks
    }

    private static func headingMatch(_ line: String) -> (level: Int, text: String)? {
        var hashes = 0
        for ch in line {
            if ch == "#" { hashes += 1 } else { break }
        }
        guard hashes >= 1, hashes <= 6 else { return nil }
        let rest = line.dropFirst(hashes)
        guard rest.first == " " else { return nil }
        return (hashes, rest.trimmingCharacters(in: .whitespaces))
    }

    private static func bulletMatch(_ line: String) -> String? {
        if line.hasPrefix("- ") || line.hasPrefix("* ") {
            return String(line.dropFirst(2))
        }
        return nil
    }
}
