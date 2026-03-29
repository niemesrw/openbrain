import SwiftUI
import OpenBrainKit

@main
struct OpenBrainApp: App {
    @State private var authService = AuthService()

    var body: some Scene {
        WindowGroup {
            ContentView(authService: authService)
                .task {
                    await APIClient.shared.configure(authService: authService)
                }
        }
    }
}
