import SwiftUI
import OpenBrainKit

struct BrowseView: View {
    @State private var thoughts: [BrainThought] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var selectedType: String? = nil

    private let typeFilters: [(label: String, value: String?)] = [
        ("All", nil),
        ("Observation", "observation"),
        ("Task", "task"),
        ("Idea", "idea"),
        ("Reference", "reference"),
        ("Person note", "person_note"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            filterBar
            content
        }
        .background(Color.obSurface)
        .navigationTitle("Browse")
        .task { await load() }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(typeFilters, id: \.label) { filter in
                    filterChip(filter)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
        }
    }

    private func filterChip(_ filter: (label: String, value: String?)) -> some View {
        let isSelected = selectedType == filter.value
        return Button {
            if selectedType != filter.value {
                selectedType = filter.value
                Task { await load() }
            }
        } label: {
            Text(filter.label)
                .font(.system(size: 12, weight: .medium))
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(isSelected ? Color.obSecondaryContainer : Color.obSurfaceContainerHigh)
                .foregroundStyle(isSelected ? Color.obOnSecondaryContainer : Color.obOnSurfaceVariant)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var content: some View {
        if isLoading {
            ProgressView()
                .tint(.obPrimary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            ContentUnavailableView(
                "Failed to Load",
                systemImage: "exclamationmark.triangle",
                description: Text(error)
            )
        } else if thoughts.isEmpty {
            ContentUnavailableView(
                "No Thoughts Yet",
                systemImage: "brain",
                description: Text("Capture some thoughts to see them here")
            )
        } else {
            List(thoughts) { thought in
                ThoughtRow(thought: thought)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.obSurface)
        }
    }

    private func load() async {
        isLoading = true
        error = nil
        do {
            thoughts = try await BrainService.browseRecent(limit: 50, type: selectedType)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
