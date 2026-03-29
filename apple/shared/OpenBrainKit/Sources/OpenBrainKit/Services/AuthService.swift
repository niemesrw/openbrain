import Foundation
import AuthenticationServices
import CryptoKit

@Observable
public final class AuthService: NSObject {
    public var isAuthenticated = false
    public var currentEmail: String?

    private var tokens: AuthTokens?
    private var authConfig: AuthConfig?
    private var currentSession: ASWebAuthenticationSession?

    public override init() {
        super.init()
        loadStoredTokens()
    }

    // MARK: - Public

    public func login(provider: String = "Google") async throws {
        let config = try await fetchAuthConfig()
        let (code, verifier) = try await startOAuthFlow(config: config, provider: provider)
        let tokens = try await exchangeCode(code, codeVerifier: verifier, config: config)
        try storeTokens(tokens)
        self.tokens = tokens
        self.currentEmail = tokens.email
        self.isAuthenticated = true
    }

    public func logout() {
        KeychainService.delete(key: Constants.keychainTokensKey)
        tokens = nil
        currentEmail = nil
        isAuthenticated = false
    }

    /// Returns a valid id_token, refreshing if needed.
    public func validToken() async throws -> String {
        guard var tokens else {
            throw AuthError.notAuthenticated
        }

        if tokens.expiresAt.timeIntervalSinceNow < 60 {
            tokens = try await refreshTokens()
        }

        return tokens.idToken
    }

    /// Forces a token refresh regardless of expiry. Called on 401 responses.
    public func forceRefresh() async throws {
        _ = try await refreshTokens()
    }

    // MARK: - OAuth Flow

    private func fetchAuthConfig() async throws -> AuthConfig {
        if let cached = authConfig { return cached }
        let url = Constants.baseURL.appendingPathComponent("auth/config")
        let (data, _) = try await URLSession.shared.data(from: url)
        let config = try JSONDecoder().decode(AuthConfig.self, from: data)
        authConfig = config
        return config
    }

    @MainActor
    private func startOAuthFlow(config: AuthConfig, provider: String) async throws -> (code: String, verifier: String) {
        let (verifier, challenge) = generatePKCE()
        let authorizeURL = buildAuthorizeURL(config: config, provider: provider, codeChallenge: challenge)

        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authorizeURL,
                callbackURLScheme: Constants.callbackScheme
            ) { [weak self] callbackURL, error in
                self?.currentSession = nil

                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let callbackURL,
                      let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                      let code = components.queryItems?.first(where: { $0.name == "code" })?.value
                else {
                    continuation.resume(throwing: AuthError.noCodeInCallback)
                    return
                }

                continuation.resume(returning: (code, verifier))
            }

            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            currentSession = session
            session.start()
        }
    }

    private func buildAuthorizeURL(config: AuthConfig, provider: String, codeChallenge: String) -> URL {
        var components = URLComponents(string: "\(config.cognitoDomain)/oauth2/authorize")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: config.effectiveClientId),
            URLQueryItem(name: "redirect_uri", value: Constants.callbackURL),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "identity_provider", value: provider),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        return components.url!
    }

    private func exchangeCode(_ code: String, codeVerifier: String, config: AuthConfig) async throws -> AuthTokens {
        let tokenURL = URL(string: "\(config.cognitoDomain)/oauth2/token")!
        var request = URLRequest(url: tokenURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = formEncode([
            "grant_type": "authorization_code",
            "client_id": config.effectiveClientId,
            "code": code,
            "redirect_uri": Constants.callbackURL,
            "code_verifier": codeVerifier,
        ])

        let (data, _) = try await URLSession.shared.data(for: request)
        let tokenResponse = try JSONDecoder().decode(TokenResponse.self, from: data)

        guard let email = JWTDecoder.email(from: tokenResponse.id_token),
              let expiresAt = JWTDecoder.expiration(from: tokenResponse.id_token),
              let refreshToken = tokenResponse.refresh_token
        else {
            throw AuthError.invalidToken
        }

        return AuthTokens(
            idToken: tokenResponse.id_token,
            refreshToken: refreshToken,
            email: email,
            expiresAt: expiresAt
        )
    }

    private func refreshTokens() async throws -> AuthTokens {
        guard let currentTokens = tokens else { throw AuthError.notAuthenticated }
        let config = try await fetchAuthConfig()

        let tokenURL = URL(string: "\(config.cognitoDomain)/oauth2/token")!
        var request = URLRequest(url: tokenURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = formEncode([
            "grant_type": "refresh_token",
            "client_id": config.effectiveClientId,
            "refresh_token": currentTokens.refreshToken,
        ])

        let (data, _) = try await URLSession.shared.data(for: request)
        let tokenResponse = try JSONDecoder().decode(TokenResponse.self, from: data)

        guard let email = JWTDecoder.email(from: tokenResponse.id_token),
              let expiresAt = JWTDecoder.expiration(from: tokenResponse.id_token)
        else {
            throw AuthError.invalidToken
        }

        let newTokens = AuthTokens(
            idToken: tokenResponse.id_token,
            refreshToken: tokenResponse.refresh_token ?? currentTokens.refreshToken,
            email: email,
            expiresAt: expiresAt
        )

        try storeTokens(newTokens)
        self.tokens = newTokens
        self.currentEmail = email
        return newTokens
    }

    // MARK: - PKCE

    private func generatePKCE() -> (verifier: String, challenge: String) {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let verifier = Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")

        let challengeData = SHA256.hash(data: Data(verifier.utf8))
        let challenge = Data(challengeData).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")

        return (verifier, challenge)
    }

    // MARK: - Helpers

    private func formEncode(_ params: [String: String]) -> Data? {
        var components = URLComponents()
        components.queryItems = params.map { URLQueryItem(name: $0.key, value: $0.value) }
        return components.percentEncodedQuery?.data(using: .utf8)
    }

    // MARK: - Storage

    private func storeTokens(_ tokens: AuthTokens) throws {
        let data = try JSONEncoder().encode(tokens)
        try KeychainService.save(key: Constants.keychainTokensKey, data: data)
    }

    private func loadStoredTokens() {
        guard let data = KeychainService.load(key: Constants.keychainTokensKey),
              let stored = try? JSONDecoder().decode(AuthTokens.self, from: data)
        else { return }

        self.tokens = stored
        self.currentEmail = stored.email
        self.isAuthenticated = true
    }

    // MARK: - Types

    private struct TokenResponse: Codable {
        let id_token: String
        let access_token: String
        let refresh_token: String?
        let token_type: String
        let expires_in: Int
    }

    public enum AuthError: Error, LocalizedError {
        case notAuthenticated
        case noCodeInCallback
        case invalidToken

        public var errorDescription: String? {
            switch self {
            case .notAuthenticated: "Not authenticated"
            case .noCodeInCallback: "No authorization code received"
            case .invalidToken: "Invalid token received"
            }
        }
    }
}

// MARK: - ASWebAuthenticationPresentationContextProviding

extension AuthService: ASWebAuthenticationPresentationContextProviding {
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if os(macOS)
        return NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor()
        #else
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        return scene?.windows.first { $0.isKeyWindow } ?? ASPresentationAnchor()
        #endif
    }
}
