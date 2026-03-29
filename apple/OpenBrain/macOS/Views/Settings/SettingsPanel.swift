import SwiftUI
import OpenBrainKit

struct SettingsPanel: View {
    let authService: AuthService

    var body: some View {
        Form {
            Section("Account") {
                if let email = authService.currentEmail {
                    LabeledContent("Email", value: email)
                }
                Button("Sign Out", role: .destructive) {
                    authService.logout()
                }
            }

            Section("About") {
                LabeledContent("Version", value: "1.0.0")
                LabeledContent("Backend", value: "brain.blanxlait.ai")
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .frame(maxWidth: 500)
    }
}
