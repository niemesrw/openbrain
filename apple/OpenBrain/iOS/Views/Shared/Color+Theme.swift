import SwiftUI

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        guard Scanner(string: hex).scanHexInt64(&int) else {
            self.init(.sRGB, red: 1, green: 1, blue: 1, opacity: 1)
            return
        }
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default: (a, r, g, b) = (255, 255, 255, 255)
        }
        self.init(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255, opacity: Double(a) / 255)
    }

    // MARK: - Surfaces (The Obsidian Stack)
    static let obSurface                 = Color(hex: "#0e0e0e")
    static let obSurfaceContainerLowest  = Color(hex: "#000000")
    static let obSurfaceContainerLow     = Color(hex: "#131313")
    static let obSurfaceContainer        = Color(hex: "#1a1a1a")
    static let obSurfaceContainerHigh    = Color(hex: "#20201f")
    static let obSurfaceContainerHighest = Color(hex: "#262626")
    static let obSurfaceVariant          = Color(hex: "#262626")

    // MARK: - Brand
    static let obPrimary                 = Color(hex: "#9aa8ff")
    static let obPrimaryContainer        = Color(hex: "#8c9bf3")
    static let obSecondary               = Color(hex: "#00e3fd")
    static let obSecondaryContainer      = Color(hex: "#006875")
    static let obOnSecondaryContainer    = Color(hex: "#e8fbff")
    static let obTertiary                = Color(hex: "#a68cff")
    static let obTertiaryContainer       = Color(hex: "#7c4dff")

    // MARK: - Text
    static let obOnSurface               = Color(hex: "#ffffff")
    static let obOnSurfaceVariant        = Color(hex: "#adaaaa")
    static let obOutline                 = Color(hex: "#767575")
    static let obOutlineVariant          = Color(hex: "#484847")

    // MARK: - Feedback
    static let obError                   = Color(hex: "#ff6e84")
    static let obErrorContainer          = Color(hex: "#a70138")
}

// MARK: - Primary gradient (used for CTAs)
extension LinearGradient {
    static let obPrimaryGradient = LinearGradient(
        colors: [.obPrimary, .obPrimaryContainer],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}
