import SwiftUI
import OpenBrainKit

struct LoginView: View {
    let authService: AuthService

    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            VStack(spacing: 12) {
                Image(systemName: "brain")
                    .font(.system(size: 64))
                    .foregroundStyle(.purple.opacity(0.8))

                Text("Open Brain")
                    .font(.system(size: 36, weight: .bold, design: .rounded))

                Text("Your personal semantic memory")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            VStack(spacing: 12) {
                Button {
                    signIn(provider: "Google")
                } label: {
                    HStack(spacing: 8) {
                        if isLoading {
                            ProgressView()
                                .tint(.white)
                        }
                        Text("Sign in with Google")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
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
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                }
                .buttonStyle(.bordered)
                .tint(.primary)
                .disabled(isLoading)

                if let error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 32)

            Spacer()
                .frame(height: 60)
        }
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
        Task {
            do {
                try await authService.loginWithApple()
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}
