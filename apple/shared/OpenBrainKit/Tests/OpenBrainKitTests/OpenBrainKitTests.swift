import Testing
@testable import OpenBrainKit

@Test func jwtDecoder() async throws {
    // Smoke test — JWTDecoder.payload returns nil for invalid input
    #expect(JWTDecoder.payload(from: "invalid") == nil)
}
