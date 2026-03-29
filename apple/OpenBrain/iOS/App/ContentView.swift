import SwiftUI
import OpenBrainKit

struct ContentView: View {
    let authService: AuthService

    var body: some View {
        if authService.isAuthenticated {
            TabView {
                NavigationStack {
                    BrainView()
                }
                .tabItem {
                    Label("Brain", systemImage: "brain")
                }

                NavigationStack {
                    SettingsView(authService: authService)
                }
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
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
