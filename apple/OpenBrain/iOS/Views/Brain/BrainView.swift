import SwiftUI
import OpenBrainKit

struct BrainView: View {
    @State private var viewModel = BrainChatViewModel()
    @FocusState private var isInputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            messageList
            inputBar
        }
        .background(Color.obSurface)
        .navigationTitle("Brain")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    viewModel.clearSession()
                } label: {
                    Label("Clear", systemImage: "arrow.counterclockwise")
                }
                .disabled(viewModel.messages.isEmpty)
            }
        }
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    if viewModel.messages.isEmpty {
                        VStack(spacing: 12) {
                            Image(systemName: "brain")
                                .font(.system(size: 40))
                                .foregroundStyle(Color.obPrimary.opacity(0.7))
                            Text("Talk to your brain")
                                .font(.system(.headline, design: .rounded, weight: .semibold))
                                .foregroundStyle(Color.obOnSurface)
                            Text("Ask what you've been thinking about, search your memories, or capture a new thought.")
                                .font(.caption)
                                .foregroundStyle(Color.obOnSurfaceVariant)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 40)
                        }
                        .padding(.top, 60)
                    }

                    ForEach(viewModel.messages) { message in
                        BrainBubbleView(message: message)
                            .id(message.id)
                    }

                    if viewModel.isSending {
                        HStack {
                            Text("Thinking...")
                                .font(.caption)
                                .foregroundStyle(Color.obOnSurfaceVariant)
                                .italic()
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                                .background(Color.obSurfaceContainer)
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                            Spacer()
                        }
                        .padding(.horizontal)
                        .id("loading")
                    }

                    if let error = viewModel.error {
                        HStack {
                            Label(error, systemImage: "exclamationmark.triangle")
                                .font(.caption)
                                .foregroundStyle(Color.obError)
                                .padding(8)
                                .background(Color.obErrorContainer.opacity(0.3))
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            Spacer()
                        }
                        .padding(.horizontal)
                    }
                }
                .padding(.vertical)
            }
            .onChange(of: viewModel.messages.count) {
                withAnimation {
                    if let last = viewModel.messages.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("Talk to your brain...", text: $viewModel.inputText, axis: .vertical)
                .textFieldStyle(.plain)
                .foregroundStyle(Color.obOnSurface)
                .lineLimit(1...5)
                .focused($isInputFocused)
                .onSubmit { send() }

            Button {
                send()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(Color.obSecondary)
                    .shadow(color: .obSecondary.opacity(0.3), radius: 8, x: 0, y: 0)
            }
            .disabled(viewModel.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isSending)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color.obSurfaceContainerLow)
    }

    private func send() {
        Task { await viewModel.sendMessage() }
    }
}

private struct BrainBubbleView: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 60) }

            Text(message.text)
                .font(.subheadline)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    message.role == .user
                        ? AnyShapeStyle(LinearGradient.obPrimaryGradient)
                        : AnyShapeStyle(Color.obSurfaceContainer)
                )
                .foregroundStyle(Color.obOnSurface)
                .clipShape(RoundedRectangle(cornerRadius: 16))

            if message.role == .agent { Spacer(minLength: 60) }
        }
        .padding(.horizontal)
    }
}
