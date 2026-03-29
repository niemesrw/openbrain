import Foundation

public struct ChatMessage: Identifiable, Sendable {
    public let id = UUID()
    public let role: Role
    public let text: String
    public let timestamp: Date

    public enum Role: Sendable {
        case user
        case agent
    }

    public init(role: Role, text: String, timestamp: Date) {
        self.role = role
        self.text = text
        self.timestamp = timestamp
    }
}
