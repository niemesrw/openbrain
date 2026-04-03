import SwiftUI
import OpenBrainKit

struct MenuBarView: View {
    let authService: AuthService

    @State private var captureText = ""
    @State private var isCapturing = false
    @State private var captureConfirmation: String?
    @State private var recentThoughts: [BrainThought] = []
    @State private var isLoadingRecent = false
    @FocusState private var isCaptureFieldFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if authService.isAuthenticated {
                authenticatedContent
            } else {
                unauthenticatedContent
            }
        }
        .frame(width: 320)
        .task {
            guard authService.isAuthenticated else { return }
            await loadRecent()
        }
    }

    // MARK: - Authenticated

    private var authenticatedContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerRow
            Divider()
            quickCaptureRow
            if let confirmation = captureConfirmation {
                confirmationRow(confirmation)
            }
            Divider()
            recentSection
            Divider()
            footerRow
        }
    }

    private var headerRow: some View {
        HStack {
            Image(systemName: "brain")
                .foregroundStyle(.purple)
            Text("Open Brain")
                .font(.headline)
            Spacer()
            if let email = authService.currentEmail {
                Text(email)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var quickCaptureRow: some View {
        HStack(spacing: 8) {
            TextField("Capture a thought...", text: $captureText, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...3)
                .focused($isCaptureFieldFocused)

            if isCapturing {
                ProgressView()
                    .scaleEffect(0.7)
                    .frame(width: 22, height: 22)
            } else {
                Button {
                    capture()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title3)
                }
                .buttonStyle(.plain)
                .foregroundStyle(canCapture ? Color.purple : Color.gray.opacity(0.3))
                .disabled(!canCapture)
                .keyboardShortcut(.return, modifiers: .command)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private func confirmationRow(_ message: String) -> some View {
        Label(message, systemImage: "checkmark.circle.fill")
            .font(.caption)
            .foregroundStyle(.green)
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.green.opacity(0.08))
    }

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Recent")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                Spacer()
                if isLoadingRecent {
                    ProgressView().scaleEffect(0.6)
                } else {
                    Button {
                        Task { await loadRecent() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.caption)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)

            if recentThoughts.isEmpty && !isLoadingRecent {
                Text("No recent thoughts")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
            } else {
                ForEach(recentThoughts.prefix(5)) { thought in
                    recentThoughtRow(thought)
                }
            }
        }
    }

    private func recentThoughtRow(_ thought: BrainThought) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: thought.typeIcon)
                .font(.caption2)
                .foregroundStyle(.purple.opacity(0.7))
                .frame(width: 14)
                .padding(.top, 2)

            Text(thought.text)
                .font(.caption)
                .foregroundStyle(.primary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    private var footerRow: some View {
        HStack {
            Button("Open Brain") {
                NSApp.activate(ignoringOtherApps: true)
            }
            .buttonStyle(.plain)
            .font(.subheadline)

            Spacer()

            Button("Sign Out", role: .destructive) {
                authService.logout()
            }
            .buttonStyle(.plain)
            .font(.subheadline)
            .foregroundStyle(.red)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: - Unauthenticated

    private var unauthenticatedContent: some View {
        VStack(spacing: 8) {
            Image(systemName: "brain")
                .font(.largeTitle)
                .foregroundStyle(.purple.opacity(0.6))
            Text("Not signed in")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button("Open Brain to Sign In") {
                NSApp.activate(ignoringOtherApps: true)
            }
            .buttonStyle(.borderedProminent)
            .tint(.purple)
            .controlSize(.small)
        }
        .frame(maxWidth: .infinity)
        .padding(16)
    }

    // MARK: - Helpers

    private var canCapture: Bool {
        !captureText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isCapturing
    }

    private func capture() {
        let trimmed = captureText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isCapturing = true
        captureConfirmation = nil
        isCaptureFieldFocused = false
        Task {
            do {
                _ = try await BrainService.captureThought(text: trimmed)
                captureText = ""
                captureConfirmation = "Captured"
                await loadRecent()
                try? await Task.sleep(for: .seconds(3))
                captureConfirmation = nil
            } catch {
                captureConfirmation = nil
            }
            isCapturing = false
        }
    }

    private func loadRecent() async {
        isLoadingRecent = true
        do {
            recentThoughts = try await BrainService.browseRecent(limit: 5)
        } catch {
            // silently ignore — menu bar should not block on errors
        }
        isLoadingRecent = false
    }
}

