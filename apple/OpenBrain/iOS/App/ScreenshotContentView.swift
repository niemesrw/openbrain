import SwiftUI
import OpenBrainKit

/// Shown when launched with -SCREENSHOT_MODE. Bypasses auth and displays demo data.
/// Pass -SCREENSHOT_TAB <Search|Browse|Capture|Stats> to start on a specific tab.
struct ScreenshotContentView: View {
    private var initialTab: Int {
        let args = ProcessInfo.processInfo.arguments
        if let idx = args.firstIndex(of: "-SCREENSHOT_TAB"), idx + 1 < args.count {
            switch args[idx + 1] {
            case "Browse":  return 1
            case "Capture": return 2
            case "Stats":   return 3
            default:        return 0
            }
        }
        return 0
    }

    var body: some View {
        TabView(selection: .constant(initialTab)) {
            NavigationStack { ScreenshotSearchView() }
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
                .tag(0)
            NavigationStack { ScreenshotBrowseView() }
                .tabItem { Label("Browse", systemImage: "list.bullet") }
                .tag(1)
            NavigationStack { ScreenshotCaptureView() }
                .tabItem { Label("Capture", systemImage: "plus.circle") }
                .tag(2)
            NavigationStack { ScreenshotStatsView() }
                .tabItem { Label("Stats", systemImage: "chart.bar") }
                .tag(3)
        }
        .tint(.obPrimary)
    }
}

// MARK: - Search (results state)

private struct ScreenshotSearchView: View {
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(Color.obOnSurfaceVariant)
                Text("What was I working on?")
                    .foregroundStyle(Color.obOnSurface)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color.obSurfaceContainerLow)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            List(DemoData.searchResults) { thought in
                ThoughtRow(thought: thought)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.obSurface)
        }
        .background(Color.obSurface)
        .navigationTitle("Search")
    }
}

// MARK: - Browse (full feed)

private struct ScreenshotBrowseView: View {
    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(["All", "Observation", "Task", "Idea", "Reference", "Person note"], id: \.self) { label in
                        Text(label)
                            .font(.system(size: 12, weight: .medium))
                            .padding(.horizontal, 14).padding(.vertical, 7)
                            .background(label == "All" ? Color.obSecondaryContainer : Color.obSurfaceContainerHigh)
                            .foregroundStyle(label == "All" ? Color.obOnSecondaryContainer : Color.obOnSurfaceVariant)
                            .clipShape(Capsule())
                    }
                }
                .padding(.horizontal).padding(.vertical, 12)
            }

            List(DemoData.thoughts) { thought in
                ThoughtRow(thought: thought)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.obSurface)
        }
        .background(Color.obSurface)
        .navigationTitle("Browse")
    }
}

// MARK: - Capture

private struct ScreenshotCaptureView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Thought")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.obOnSurfaceVariant)
                    Text("Ship the iOS app to App Store this week — metadata, screenshots, and privacy policy still outstanding.")
                        .foregroundStyle(Color.obOnSurface)
                        .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
                        .padding(10)
                        .background(Color.obSurfaceContainerLow)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.obOutlineVariant.opacity(0.15), lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Type")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.obOnSurfaceVariant)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(["Auto-detect", "Observation", "Task", "Idea", "Reference", "Person note"], id: \.self) { label in
                                Label(label, systemImage: "sparkles")
                                    .font(.system(size: 12, weight: .medium))
                                    .padding(.horizontal, 12).padding(.vertical, 7)
                                    .background(label == "Task" ? Color.obSecondaryContainer : Color.obSurfaceContainerHigh)
                                    .foregroundStyle(label == "Task" ? Color.obOnSecondaryContainer : Color.obOnSurfaceVariant)
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }

                Text("Capture Thought")
                    .font(.system(.subheadline, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(LinearGradient.obPrimaryGradient)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .padding()
        }
        .background(Color.obSurface)
        .navigationTitle("Capture")
    }
}

// MARK: - Stats

private struct ScreenshotStatsView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Brain Overview", systemImage: "brain")
                        .font(.system(.headline, design: .rounded, weight: .semibold))
                        .foregroundStyle(Color.obPrimary)
                    Text(DemoData.statsText)
                        .font(.subheadline)
                        .foregroundStyle(Color.obOnSurface)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.obSurfaceContainerLow)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .shadow(color: .obPrimary.opacity(0.08), radius: 16, x: 0, y: 0)
            }
            .padding()
        }
        .background(Color.obSurface)
        .navigationTitle("Stats")
    }
}
