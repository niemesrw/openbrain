import SwiftUI
import OpenBrainKit

struct ThoughtRow: View {
    let thought: BrainThought

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: typeIcon)
                    .font(.caption)
                    .foregroundStyle(typeColor)
                Text(thought.type.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.caption)
                    .foregroundStyle(typeColor)
                Spacer()
            }
            Text(thought.text)
                .font(.subheadline)
                .foregroundStyle(.primary)
                .lineLimit(4)
        }
        .padding(.vertical, 4)
    }

    private var typeIcon: String {
        switch thought.type {
        case "observation": return "eye"
        case "task": return "checkmark.circle"
        case "idea": return "lightbulb"
        case "reference": return "link"
        case "person_note": return "person"
        default: return "bubble.left"
        }
    }

    private var typeColor: Color {
        switch thought.type {
        case "observation": return .blue
        case "task": return .orange
        case "idea": return .yellow
        case "reference": return .teal
        case "person_note": return .green
        default: return .purple
        }
    }
}
