import SwiftUI
import OpenBrainKit

// MARK: - BrainThought macOS extensions

extension BrainThought {
    var typeIcon: String {
        switch type {
        case "observation": return "eye"
        case "task": return "checkmark.circle"
        case "idea": return "lightbulb"
        case "reference": return "link"
        case "person_note": return "person"
        default: return "bubble.left"
        }
    }

    var typeColor: Color {
        switch type {
        case "observation": return .blue
        case "task": return .orange
        case "idea": return .yellow
        case "reference": return .teal
        case "person_note": return .green
        default: return .purple
        }
    }
}

// MARK: - MacThoughtRow

struct MacThoughtRow: View {
    let thought: BrainThought
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: thought.typeIcon)
                    .font(.caption)
                    .foregroundStyle(thought.typeColor)
                Text(thought.type.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.caption)
                    .foregroundStyle(thought.typeColor)
                Spacer()
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) { isExpanded.toggle() }
                } label: {
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
            }

            Text(thought.text)
                .font(.subheadline)
                .foregroundStyle(.primary)
                .lineLimit(isExpanded ? nil : 3)
                .textSelection(.enabled)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .onTapGesture {
            withAnimation(.easeInOut(duration: 0.15)) { isExpanded.toggle() }
        }
    }
}
