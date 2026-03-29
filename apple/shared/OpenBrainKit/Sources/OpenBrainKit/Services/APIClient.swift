import Foundation

public actor APIClient {
    public static let shared = APIClient()

    private let session = URLSession.shared
    private let baseURL = Constants.baseURL
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    private weak var authService: AuthService?

    public func configure(authService: AuthService) {
        self.authService = authService
    }

    // MARK: - Request Methods

    public func get<T: Decodable>(
        _ path: String,
        query: [String: String]? = nil,
        authenticated: Bool = false
    ) async throws -> T {
        try await request("GET", path: path, query: query, authenticated: authenticated)
    }

    public func post<T: Decodable>(
        _ path: String,
        body: (any Encodable)? = nil,
        authenticated: Bool = false
    ) async throws -> T {
        try await request("POST", path: path, body: body, authenticated: authenticated)
    }

    // MARK: - Core

    private func request<T: Decodable>(
        _ method: String,
        path: String,
        query: [String: String]? = nil,
        body: (any Encodable)? = nil,
        authenticated: Bool = false,
        isRetry: Bool = false
    ) async throws -> T {
        var urlComponents = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!

        if let query {
            urlComponents.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }

        var request = URLRequest(url: urlComponents.url!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(AnyEncodable(body))
        }

        if authenticated {
            guard let authService else {
                throw APIClientError.authServiceNotConfigured
            }
            let token = try await authService.validToken()
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        if httpResponse.statusCode == 401 && authenticated && !isRetry {
            try await authService?.forceRefresh()
            return try await self.request(method, path: path, query: query, body: body, authenticated: true, isRetry: true)
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if let apiError = try? decoder.decode(APIError.self, from: data) {
                throw apiError
            }
            throw APIClientError.httpError(httpResponse.statusCode)
        }

        return try decoder.decode(T.self, from: data)
    }

    /// POST with raw JSON data body, returns raw Data. Used by BrainService for JSON-RPC.
    public func postRaw(
        _ path: String,
        jsonData: Data
    ) async throws -> Data {
        let urlComponents = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        var request = URLRequest(url: urlComponents.url!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = jsonData

        guard let authService else {
            throw APIClientError.authServiceNotConfigured
        }
        let token = try await authService.validToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIClientError.httpError(httpResponse.statusCode)
        }

        return data
    }

    // MARK: - Errors

    public enum APIClientError: Error, LocalizedError {
        case authServiceNotConfigured
        case invalidResponse
        case httpError(Int)

        public var errorDescription: String? {
            switch self {
            case .authServiceNotConfigured: "Auth service not configured"
            case .invalidResponse: "Invalid response from server"
            case .httpError(let code): "HTTP error \(code)"
            }
        }
    }
}

private struct AnyEncodable: Encodable {
    private let _encode: (Encoder) throws -> Void

    init(_ wrapped: any Encodable) {
        _encode = wrapped.encode(to:)
    }

    func encode(to encoder: Encoder) throws {
        try _encode(encoder)
    }
}
