import Foundation

@Observable
@MainActor
public final class BrainChatViewModel {
    public var messages: [ChatMessage] = []
    public var inputText = ""
    public var isSending = false
    public var error: String?

    public init() {}

    public func sendMessage() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let userMessage = ChatMessage(role: .user, text: text, timestamp: Date())
        messages.append(userMessage)
        inputText = ""
        isSending = true
        error = nil

        // Build history from previous messages (exclude the one we just added)
        let history = messages.dropLast().map { msg in
            BrainChatMessage(
                role: msg.role == .user ? "user" : "assistant",
                content: msg.text
            )
        }

        do {
            let response = try await BrainChatService.sendMessage(text, history: Array(history))
            let brainMessage = ChatMessage(role: .agent, text: response.response, timestamp: Date())
            messages.append(brainMessage)
        } catch {
            self.error = error.localizedDescription
        }

        isSending = false
    }

    public func clearSession() {
        messages.removeAll()
        error = nil
    }
}
