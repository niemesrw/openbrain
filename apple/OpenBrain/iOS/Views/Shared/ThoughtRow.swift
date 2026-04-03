import SwiftUI
import OpenBrainKit

struct ThoughtRow: View {
    let thought: BrainThought

    var body: some View {
        NavigationLink(destination: ThoughtDetailView(thought: thought)) {
            VStack(alignment: .leading, spacing: 8) {
                // Type badge — pill style per design system
                Label(thought.type.replacingOccurrences(of: "_", with: " ").capitalized, systemImage: thought.typeIcon)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(thought.typeColor)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(thought.typeColor.opacity(0.15))
                    .clipShape(Capsule())

                Text(thought.text)
                    .font(.subheadline)
                    .foregroundStyle(Color.obOnSurface)
                    .lineLimit(4)
            }
            .padding(.vertical, 8)
        }
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }
}

extension BrainThought {
    var typeIcon: String {
        switch type {
        case "observation": return "eye"
        case "task":        return "checkmark.circle"
        case "idea":        return "lightbulb"
        case "reference":   return "link"
        case "person_note": return "person"
        default:            return "bubble.left"
        }
    }

    var typeColor: Color {
        switch type {
        case "observation": return .obPrimary
        case "task":        return Color(hex: "#ff9f4a")
        case "idea":        return Color(hex: "#ffd166")
        case "reference":   return .obSecondary
        case "person_note": return .obTertiary
        default:            return .obOnSurfaceVariant
        }
    }
}
