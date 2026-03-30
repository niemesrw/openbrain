import SwiftUI
import OpenBrainKit

struct SearchView: View {
    @State private var query = ""
    @State private var results: [BrainThought] = []
    @State private var isSearching = false
    @State private var error: String?
    @State private var hasSearched = false

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
                .submitLabel(.search)
                .onSubmit { search() }
            if !query.isEmpty {
                Button {
                    query = ""
                    results = []
                    hasSearched = false
                    error = nil
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    private var resultsList: some View {
        Group {
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
                ContentUnavailableView(
                    "Search Your Brain",
                    systemImage: "brain",
                    description: Text("Enter a query to search your thoughts semantically")
                )
            } else {
                List(results) { thought in
                    ThoughtRow(thought: thought)
                }
                .listStyle(.plain)
            }
        }
    }

    private func search() {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSearching = true
        error = nil
        Task {
            do {
                results = try await BrainService.searchThoughts(query: trimmed)
                hasSearched = true
            } catch {
                self.error = error.localizedDescription
            }
            isSearching = false
        }
    }
}
