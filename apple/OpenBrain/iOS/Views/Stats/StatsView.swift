import SwiftUI
import OpenBrainKit

struct StatsView: View {
    @State private var statsText: String?
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        content
            .background(Color.obSurface)
            .navigationTitle("Stats")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await load() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .disabled(isLoading)
                }
            }
            .task { await load() }
            .refreshable { await load() }
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
        } else if let statsText {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    statsCard(statsText)
                }
                .padding()
            }
        } else {
            ContentUnavailableView(
                "No Stats",
                systemImage: "chart.bar",
                description: Text("Capture some thoughts to see stats")
            )
        }
    }

    private func statsCard(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Brain Overview", systemImage: "brain")
                .font(.system(.headline, design: .rounded, weight: .semibold))
                .foregroundStyle(Color.obPrimary)

            Text(text)
                .font(.subheadline)
                .foregroundStyle(Color.obOnSurface)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.obSurfaceContainerLow)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: .obPrimary.opacity(0.08), radius: 16, x: 0, y: 0)
    }

    private func load() async {
        isLoading = true
        error = nil
        do {
            let results = try await BrainService.stats()
            statsText = results.first?.text
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
