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

                Text(thought.text)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .textSelection(.enabled)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Thought")
        .navigationBarTitleDisplayMode(.inline)
    }
}
