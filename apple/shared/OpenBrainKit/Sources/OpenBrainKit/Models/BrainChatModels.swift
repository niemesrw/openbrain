import Foundation

public struct BrainChatMessage: Codable, Sendable {
    public let role: String
    public let content: String

    public init(role: String, content: String) {
        self.role = role
        self.content = content
    }
}

public struct BrainChatRequest: Encodable, Sendable {
    public let message: String
    public let history: [BrainChatMessage]?

    public init(message: String, history: [BrainChatMessage]?) {
        self.message = message
        self.history = history
    }
}

public struct BrainChatResponse: Decodable, Sendable {
    public let response: String
    public let toolsUsed: [String]
    public let thoughtsReferenced: Int
}
