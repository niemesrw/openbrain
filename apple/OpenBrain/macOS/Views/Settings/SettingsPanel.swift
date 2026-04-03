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

            Section("Connection") {
                LabeledContent("MCP Server", value: Constants.baseURL.host() ?? "")
                LabeledContent("MCP URL") {
                    Text(Constants.baseURL.appendingPathComponent("mcp").absoluteString)
                        .textSelection(.enabled)
                        .foregroundStyle(.secondary)
                }
                LabeledContent("OAuth Discovery") {
                    Text(Constants.baseURL.appendingPathComponent(".well-known/oauth-authorization-server").absoluteString)
                        .textSelection(.enabled)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            Section("Keyboard Shortcut") {
                LabeledContent("Open Popover", value: "⌘⇧B")
                    .help("Activate the app first (click the menu bar icon), then use this shortcut")
                Text("Use the menu bar icon to open the popover from any context.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            Section("About") {
                LabeledContent("Version", value: "1.0.0")
                LabeledContent("Backend", value: Constants.baseURL.host() ?? "")
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .frame(maxWidth: 500)
    }
}
