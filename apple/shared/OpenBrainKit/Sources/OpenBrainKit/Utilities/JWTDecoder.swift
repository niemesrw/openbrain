import Foundation

public enum JWTDecoder {
    /// Decode a JWT payload without verifying the signature (server handles verification).
    public static func payload(from jwt: String) -> [String: Any]? {
        let segments = jwt.split(separator: ".")
        guard segments.count == 3 else { return nil }

        var base64 = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }

        guard let data = Data(base64Encoded: base64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }

        return json
    }

    public static func email(from jwt: String) -> String? {
        payload(from: jwt)?["email"] as? String
    }

    public static func expiration(from jwt: String) -> Date? {
        guard let exp = payload(from: jwt)?["exp"] as? Double else { return nil }
        return Date(timeIntervalSince1970: exp)
    }
}
