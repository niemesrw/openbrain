import Foundation

public enum Constants {
    public static let baseURL = URL(string: "https://brain.blanxlait.ai")!
    public static let callbackScheme = "openbrain"
    public static let callbackURL = "openbrain://callback"
    public static let keychainServiceName = "com.blanxlait.openbrain"
    public static let keychainTokensKey = "auth_tokens"
}
