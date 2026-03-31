import SwiftUI

struct SidebarView: View {
    @Binding var selection: SidebarSection

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            sectionGroup("Brain", sections: [.brain, .capture])
            Divider().padding(.horizontal, 12).padding(.vertical, 4)
            sectionGroup("Library", sections: [.search, .browse, .stats])
            Divider().padding(.horizontal, 12).padding(.vertical, 4)
            sectionGroup(nil, sections: [.settings])
            Spacer()
        }
        .padding(.vertical, 4)
        .navigationTitle("Open Brain")
    }

    @ViewBuilder
    private func sectionGroup(_ title: String?, sections: [SidebarSection]) -> some View {
        if let title {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .padding(.bottom, 2)
        }
        ForEach(sections) { section in
            SidebarButton(
                section: section,
                isSelected: selection == section
            ) {
                selection = section
            }
        }
    }
}

private struct SidebarButton: View {
    let section: SidebarSection
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Label(section.rawValue, systemImage: section.icon)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                isSelected
                    ? Color.accentColor.opacity(0.15)
                    : Color.clear
            )
            .contentShape(Rectangle())
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .foregroundStyle(isSelected ? .primary : .secondary)
        .padding(.horizontal, 8)
    }
}
