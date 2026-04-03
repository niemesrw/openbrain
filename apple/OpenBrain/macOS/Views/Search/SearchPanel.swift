import SwiftUI
import OpenBrainKit

struct SearchPanel: View {
    @State private var query = ""
    @State private var results: [BrainThought] = []
    @State private var isSearching = false
    @State private var error: String?
    @State private var hasSearched = false
    @State private var searchTask: Task<Void, Never>?
    @FocusState private var isFieldFocused: Bool

    private let suggestions: [(String, String)] = [
        ("Recent decisions", "arrow.triangle.branch"),
        ("Action items", "checkmark.circle"),
        ("People I've met", "person.2"),
        ("Project ideas", "lightbulb"),
        ("Things to follow up", "arrow.uturn.right"),
        ("What was I working on?", "hammer"),
        ("Notes from this week", "calendar"),
        ("Lessons learned", "graduationcap"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            searchBar
            Divider()
            resultsList
        }
        .navigationTitle("Search")
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search your brain...", text: $query)
                .textFieldStyle(.plain)
                .focused($isFieldFocused)
                .onSubmit { search() }
            if !query.isEmpty {
                Button {
                    searchTask?.cancel()
                    searchTask = nil
                    query = ""
                    results = []
                    hasSearched = false
                    isSearching = false
                    error = nil
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var resultsList: some View {
        if isSearching {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            ContentUnavailableView(
                "Search Failed",
                systemImage: "exclamationmark.triangle",
                description: Text(error)
            )
        } else if hasSearched && results.isEmpty {
            ContentUnavailableView(
                "No Results",
                systemImage: "magnifyingglass",
                description: Text("Nothing matched \"\(query)\"")
            )
        } else if !hasSearched {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Suggested")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .padding(.horizontal, 16)

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                        ForEach(suggestions, id: \.0) { label, icon in
                            Button {
                                query = label
                                search()
                            } label: {
                                Label(label, systemImage: icon)
                                    .font(.caption)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 7)
                                    .background(Color.secondary.opacity(0.1))
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.vertical, 16)
            }
        } else {
            List(results) { thought in
                MacThoughtRow(thought: thought)
            }
            .listStyle(.plain)
        }
    }

    private func search() {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        searchTask?.cancel()
        isSearching = true
        error = nil
        searchTask = Task {
            do {
                let found = try await BrainService.searchThoughts(query: trimmed)
                guard !Task.isCancelled else { return }
                results = found
                hasSearched = true
            } catch {
                guard !Task.isCancelled else { return }
                self.error = error.localizedDescription
            }
            isSearching = false
        }
    }
}
