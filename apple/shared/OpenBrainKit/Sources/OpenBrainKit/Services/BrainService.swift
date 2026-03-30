import Foundation

public enum BrainService {
    public static func searchThoughts(query: String, limit: Int = 10) async throws -> [BrainThought] {
        try await callTool("search_thoughts", arguments: [
            "query": query,
            "limit": limit,
        ] as [String: Any])
    }

    public static func browseRecent(limit: Int = 20, type: String? = nil) async throws -> [BrainThought] {
        var args: [String: Any] = ["limit": limit]
        if let type { args["type"] = type }
        return try await callTool("browse_recent", arguments: args)
    }

    public static func captureThought(text: String, type: String? = nil) async throws -> [BrainThought] {
        var args: [String: Any] = ["text": text]
        if let type { args["type"] = type }
        return try await callTool("capture_thought", arguments: args)
    }

    public static func stats() async throws -> [BrainThought] {
        try await callTool("stats", arguments: [:] as [String: Any])
    }

    // MARK: - JSON-RPC

    private static func callTool(_ name: String, arguments: [String: Any]) async throws -> [BrainThought] {
        let body: [String: Any] = [
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": [
                "name": name,
                "arguments": arguments,
            ],
        ]

        let jsonData = try JSONSerialization.data(withJSONObject: body)
        let responseData = try await APIClient.shared.postRaw("/mcp", jsonData: jsonData)

        guard let json = try JSONSerialization.jsonObject(with: responseData) as? [String: Any] else {
            throw BrainError.invalidResponse
        }

        if let error = json["error"] as? [String: Any],
           let message = error["message"] as? String {
            throw BrainError.jsonRpcError(message)
        }

        guard let result = json["result"] as? [String: Any],
              let content = result["content"] as? [[String: Any]]
        else {
            throw BrainError.invalidResponse
        }

        return content.compactMap { item in
            guard let type = item["type"] as? String,
                  let text = item["text"] as? String
            else { return nil }
            return BrainThought(type: type, text: text)
        }
    }
}

public enum BrainError: Error, LocalizedError {
    case jsonRpcError(String)
    case invalidResponse

    public var errorDescription: String? {
        switch self {
        case .jsonRpcError(let msg): msg
        case .invalidResponse: "Invalid response from brain"
        }
    }
}

public struct BrainThought: Identifiable, Sendable {
    public let id = UUID()
    public let type: String
    public let text: String

    public init(type: String, text: String) {
        self.type = type
        self.text = text
    }
}
