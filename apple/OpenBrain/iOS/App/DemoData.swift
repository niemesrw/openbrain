import Foundation
import OpenBrainKit

/// Sample thoughts shown in screenshot / demo mode.
/// Activated by passing "-SCREENSHOT_MODE" as a launch argument.
enum DemoData {
    static var isScreenshotMode: Bool {
        ProcessInfo.processInfo.arguments.contains("-SCREENSHOT_MODE")
    }

    static let thoughts: [BrainThought] = [
        BrainThought(type: "observation", text: "Decided to use S3 Vectors for brain storage — simpler than a dedicated vector DB, and the index-per-user model gives clean isolation without extra infra."),
        BrainThought(type: "task",        text: "Follow up with Sarah about the Q2 roadmap review before the board deck goes out. She wants input on the agent orchestration milestone."),
        BrainThought(type: "idea",        text: "What if the brain could proactively surface relevant memories during meetings? A subtle ambient layer that injects context exactly when you need it."),
        BrainThought(type: "reference",   text: "MCP Authorization spec (OAuth 2.1) — Dynamic Client Registration lets any MCP client authenticate without pre-registration. See: empires-security/mcp-oauth2-aws-cognito."),
        BrainThought(type: "person_note", text: "Met James at the AI meetup — works on inference optimization at a stealth startup. Deeply interested in long-context retrieval. Follow up about the open-source vector work."),
        BrainThought(type: "observation", text: "Bedrock cross-region inference profiles require IAM access to both the profile ARN and the underlying foundation model ARNs in each routable region. Caught this the hard way."),
        BrainThought(type: "task",        text: "Ship the iOS app to App Store this week — metadata, screenshots, and privacy policy still outstanding."),
        BrainThought(type: "idea",        text: "Space Grotesk + Inter dual-font system gives the right editorial feel. Space Grotesk for headlines conveys precision; Inter keeps data density high."),
    ]

    static let searchResults: [BrainThought] = Array(thoughts.prefix(4))

    static let statsText = """
    🧠 Brain Overview

    Total thoughts: 47
    • Observations: 18
    • Tasks: 12
    • Ideas: 9
    • References: 5
    • Person notes: 3

    Topics: AWS, AI, design, product, iOS, MCP, architecture
    People: Sarah, James, Alex

    Last captured: today
    """
}
