import Foundation

public enum Constants {
    // Replace with your deployed API Gateway URL (output of CDK deploy)
    public static let baseURL = URL(string: "https://your-api-id.execute-api.us-east-1.amazonaws.com")!
    public static let callbackScheme = "openbrain"
    public static let callbackURL = "openbrain://callback"
    public static let keychainServiceName = "com.your-bundle-id.openbrain"
    public static let keychainTokensKey = "auth_tokens"
}
