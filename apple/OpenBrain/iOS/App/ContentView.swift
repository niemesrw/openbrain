import SwiftUI
import OpenBrainKit

struct ContentView: View {
    let authService: AuthService
    @State private var showCapture = false

    private var isScreenshotMode: Bool {
        #if DEBUG
        return DemoData.isScreenshotMode
        #else
        return false
        #endif
    }

    var body: some View {
        if isScreenshotMode {
            ScreenshotContentView()
        } else if authService.isAuthenticated {
            TabView {
                NavigationStack {
                    SearchView()
                }
                .tabItem {
                    Label("Search", systemImage: "magnifyingglass")
                }

                NavigationStack {
                    BrowseView()
                }
                .tabItem {
                    Label("Browse", systemImage: "list.bullet")
                }

                // Capture tab — presents a sheet, never actually navigates
                Color.clear
                    .tabItem {
                        Label("Capture", systemImage: "plus.circle")
                    }
                    .onAppear { showCapture = true }

                NavigationStack {
                    StatsView()
                }
                .tabItem {
                    Label("Stats", systemImage: "chart.bar")
                }

                NavigationStack {
                    SettingsView(authService: authService)
                }
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
            }
            .tint(.obPrimary)
            .sheet(isPresented: $showCapture) {
                NavigationStack {
                    CaptureView()
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Cancel") { showCapture = false }
                            }
                        }
                }
            }
        } else {
            LoginView(authService: authService)
        }
    }
}

struct SettingsView: View {
    let authService: AuthService

    var body: some View {
        List {
            Section {
                if let email = authService.currentEmail {
                    LabeledContent("Email", value: email)
                }
            }

            Section {
                Button("Sign Out", role: .destructive) {
                    authService.logout()
                }
            }

            Section {
                LabeledContent("Version", value: "1.0.0")
            }
        }
        .navigationTitle("Settings")
    }
}
