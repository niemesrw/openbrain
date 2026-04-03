import Foundation

public enum Constants {
    /// API Gateway URL injected at build time via Config.xcconfig (local) or
    /// the OPENBRAIN_API_URL Xcode Cloud secret (CI). Never hardcoded.
    public static let baseURL: URL = {
        guard
            let host = Bundle.main.infoDictionary?["APIBaseHost"] as? String,
            !host.isEmpty,
            let url = URL(string: "https://\(host)")
        else {
            fatalError(
                "APIBaseHost not configured. " +
                "Copy apple/OpenBrain/Config.xcconfig.example to Config.xcconfig and set API_BASE_HOST " +
                "(hostname only, no https://), then run `xcodegen generate`."
            )
        }
        return url
    }()

    public static let callbackScheme = "openbrain"
    public static let callbackURL = "openbrain://callback"
    public static let keychainServiceName: String = {
        Bundle.main.infoDictionary?["KeychainServiceName"] as? String
            ?? Bundle.main.bundleIdentifier
            ?? "com.your-bundle-id.openbrain"
    }()
    public static let keychainTokensKey = "auth_tokens"
}
