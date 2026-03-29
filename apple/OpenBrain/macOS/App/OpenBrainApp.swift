import SwiftUI
import OpenBrainKit

@main
struct OpenBrainApp: App {
    @State private var authService = AuthService()

    var body: some Scene {
        WindowGroup {
            ContentView(authService: authService)
                .frame(minWidth: 800, minHeight: 500)
                .task {
                    await APIClient.shared.configure(authService: authService)
                }
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 1000, height: 700)

        MenuBarExtra("Open Brain", systemImage: "brain") {
            MenuBarView(authService: authService)
        }
    }
}
