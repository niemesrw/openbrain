import Foundation

public struct APIError: Codable, Error, LocalizedError, Sendable {
    public let error: String
    public let statusCode: Int?

    public var errorDescription: String? { error }
}
