import SwiftUI
import OpenBrainKit

struct MenuBarView: View {
    let authService: AuthService

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if authService.isAuthenticated {
                if let email = authService.currentEmail {
                    Text(email)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.top, 4)
                }
                Divider()
                Button("Open Brain") {
                    NSApp.activate(ignoringOtherApps: true)
                }
                Divider()
                Button("Sign Out", role: .destructive) {
                    authService.logout()
                }
            } else {
                Text("Not signed in")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.top, 4)
                Divider()
                Button("Open Brain") {
                    NSApp.activate(ignoringOtherApps: true)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
