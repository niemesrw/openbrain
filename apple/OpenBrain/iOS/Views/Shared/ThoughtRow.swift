import SwiftUI
import OpenBrainKit

struct ThoughtRow: View {
    let thought: BrainThought

    var body: some View {
        NavigationLink(destination: ThoughtDetailView(thought: thought)) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: thought.typeIcon)
                        .font(.caption)
                        .foregroundStyle(thought.typeColor)
                    Text(thought.type.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.caption)
                        .foregroundStyle(thought.typeColor)
                    Spacer()
                }
                Text(thought.text)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .lineLimit(4)
            }
            .padding(.vertical, 4)
        }
    }
}

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
