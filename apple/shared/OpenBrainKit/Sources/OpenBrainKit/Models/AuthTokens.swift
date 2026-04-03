import Foundation

public struct AuthTokens: Codable, Sendable {
    public let idToken: String
    public let refreshToken: String
    public let email: String
    public let expiresAt: Date

    public init(idToken: String, refreshToken: String, email: String, expiresAt: Date) {
        self.idToken = idToken
        self.refreshToken = refreshToken
        self.email = email
        self.expiresAt = expiresAt
    }
}

public struct AuthConfig: Codable, Sendable {
    public let cognitoDomain: String
    public let clientId: String
    public let mobileClientId: String?

    /// Use mobileClientId if present and non-empty, otherwise fall back to CLI clientId.
    public var effectiveClientId: String {
        if let id = mobileClientId, !id.isEmpty { return id }
        return clientId
    }
}
