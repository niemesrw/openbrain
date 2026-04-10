import SwiftUI
import OpenBrainKit

struct LoginView: View {
    let authService: AuthService

    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 40) {
            Spacer()

            VStack(spacing: 16) {
                Image(systemName: "brain")
                    .font(.system(size: 56))
                    .foregroundStyle(.purple.opacity(0.8))

                Text("Open Brain")
                    .font(.system(size: 42, weight: .bold, design: .rounded))

                Text("Your personal semantic memory")
                    .font(.title2)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 12) {
                Button {
                    signIn(provider: "Google")
                } label: {
                    HStack(spacing: 8) {
                        if isLoading {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text("Sign in with Google")
                            .fontWeight(.semibold)
                    }
                    .frame(width: 240, height: 36)
                }
                .buttonStyle(.borderedProminent)
                .tint(.purple)
                .disabled(isLoading)

                Button {
                    signInWithApple()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "apple.logo")
                        Text("Sign in with Apple")
                            .fontWeight(.semibold)
                    }
                    .frame(width: 240, height: 36)
                }
                .buttonStyle(.bordered)
                .disabled(isLoading)

                if let error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func signIn(provider: String) {
        isLoading = true
        error = nil
        Task {
            do {
                try await authService.login(provider: provider)
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }

    private func signInWithApple() {
        isLoading = true
        error = nil
        Task { @MainActor in
            do {
                try await authService.loginWithApple()
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}
