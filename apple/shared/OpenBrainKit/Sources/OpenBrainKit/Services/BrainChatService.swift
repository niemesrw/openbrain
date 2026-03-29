import Foundation

public enum BrainChatService {
    public static func sendMessage(
        _ message: String,
        history: [BrainChatMessage]
    ) async throws -> BrainChatResponse {
        let request = BrainChatRequest(
            message: message,
            history: history.isEmpty ? nil : history
        )
        return try await APIClient.shared.post(
            "/brain/chat",
            body: request,
            authenticated: true
        )
    }
}
