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
    @State private var showDeleteConfirmation = false
    @State private var isDeletingAccount = false
    @State private var deleteError: String?

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
                Button("Delete Account & Data", role: .destructive) {
                    showDeleteConfirmation = true
                }
                .disabled(isDeletingAccount)
            } footer: {
                Text("Permanently deletes your account, private thoughts, agent keys, and connected integrations. This cannot be undone.")
                    .foregroundStyle(.secondary)
            }

            Section {
                LabeledContent("Version", value: "1.0.0")
            }
        }
        .navigationTitle("Settings")
        .confirmationDialog(
            "Delete Account & Data?",
            isPresented: $showDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete Everything", role: .destructive) {
                Task { await deleteAccount() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will permanently delete your account, private thoughts, agent keys, and connected integrations (GitHub, Slack, Google). This cannot be undone.")
        }
        .alert("Delete Failed", isPresented: Binding(
            get: { deleteError != nil },
            set: { if !$0 { deleteError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(deleteError ?? "")
        }
    }

    private func deleteAccount() async {
        isDeletingAccount = true
        do {
            struct DeleteResponse: Decodable { let ok: Bool }
            let _: DeleteResponse = try await APIClient.shared.delete("/user", authenticated: true)
            authService.logout()
        } catch {
            deleteError = error.localizedDescription
            isDeletingAccount = false
        }
    }
}
