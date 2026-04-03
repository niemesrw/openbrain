import SwiftUI
import OpenBrainKit

struct ThoughtDetailView: View {
    let thought: BrainThought

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Label(
                    thought.type.replacingOccurrences(of: "_", with: " ").capitalized,
                    systemImage: thought.typeIcon
                )
                .font(.caption)
                .foregroundStyle(thought.typeColor)

                MarkdownText(thought.text)
                    .textSelection(.enabled)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Thought")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Renders a subset of Markdown: headings, bullet lists, inline bold/code.
private struct MarkdownText: View {
    let raw: String

    init(_ raw: String) { self.raw = raw }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
    }

    // MARK: - Block parsing

    private enum Block {
        case heading(level: Int, text: String)
        case bullet(text: String)
        case paragraph(text: String)
        case empty
    }

    private var blocks: [Block] {
        raw.components(separatedBy: "\n").map { line in
            if line.hasPrefix("### ") { return .heading(level: 3, text: String(line.dropFirst(4))) }
            if line.hasPrefix("## ")  { return .heading(level: 2, text: String(line.dropFirst(3))) }
            if line.hasPrefix("# ")   { return .heading(level: 1, text: String(line.dropFirst(2))) }
            if line.hasPrefix("- ")   { return .bullet(text: String(line.dropFirst(2))) }
            if line.hasPrefix("* ")   { return .bullet(text: String(line.dropFirst(2))) }
            if line.trimmingCharacters(in: .whitespaces).isEmpty { return .empty }
            return .paragraph(text: line)
        }
    }

    @ViewBuilder
    private func blockView(_ block: Block) -> some View {
        switch block {
        case .heading(let level, let text):
            inlineText(text)
                .font(level == 1 ? .title2.bold() : level == 2 ? .title3.bold() : .headline)
                .padding(.top, level <= 2 ? 8 : 4)

        case .bullet(let text):
            HStack(alignment: .top, spacing: 8) {
                Text("•").foregroundStyle(.secondary)
                inlineText(text)
            }

        case .paragraph(let text):
            inlineText(text)
                .font(.body)

        case .empty:
            Spacer().frame(height: 4)
        }
    }

    /// Renders inline bold (**text**) and code (`text`) within a line.
    private func inlineText(_ text: String) -> Text {
        var result = Text("")
        var remaining = text[text.startIndex...]

        let patterns: [(String, String, (String) -> Text)] = [
            ("**", "**", { Text($0).bold() }),
            ("`",  "`",  { Text($0).font(.system(.body, design: .monospaced)).foregroundColor(.secondary) }),
        ]

        while !remaining.isEmpty {
            var matched = false
            for (open, close, style) in patterns {
                guard remaining.hasPrefix(open),
                      let closeRange = remaining.dropFirst(open.count).range(of: close)
                else { continue }

                let innerStart = remaining.index(remaining.startIndex, offsetBy: open.count)
                let inner = String(remaining[innerStart ..< closeRange.lowerBound])
                let afterClose = remaining.index(closeRange.upperBound, offsetBy: close.count > 1 ? close.count - 1 : 0)
                result = result + style(inner)
                remaining = remaining[afterClose...]
                matched = true
                break
            }
            if !matched {
                result = result + Text(String(remaining.removeFirst()))
            }
        }
        return result
    }
}
