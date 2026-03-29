import SwiftUI
import OpenBrainKit

struct ContentView: View {
    let authService: AuthService

    var body: some View {
        if authService.isAuthenticated {
            MainView(authService: authService)
        } else {
            LoginView(authService: authService)
        }
    }
}
