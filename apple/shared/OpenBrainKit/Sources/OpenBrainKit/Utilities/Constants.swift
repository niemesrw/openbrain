import Foundation

public enum Constants {
    /// API Gateway URL injected at build time via Config.xcconfig (local) or
    /// the OPENBRAIN_API_URL Xcode Cloud secret (CI). Never hardcoded.
    public static let baseURL: URL = {
        guard
            let raw = Bundle.main.infoDictionary?["APIBaseURL"] as? String,
            !raw.isEmpty,
            let url = URL(string: raw)
        else {
            fatalError(
                "APIBaseURL not configured. " +
                "Copy apple/OpenBrain/Config.xcconfig.example to Config.xcconfig and set API_BASE_URL, " +
                "then run `xcodegen generate`."
            )
        }
        return url
    }()

    public static let callbackScheme = "openbrain"
    public static let callbackURL = "openbrain://callback"
    public static let keychainServiceName = "com.your-bundle-id.openbrain"
    public static let keychainTokensKey = "auth_tokens"
}
