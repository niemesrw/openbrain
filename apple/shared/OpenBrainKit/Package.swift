// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "OpenBrainKit",
    platforms: [
        .macOS(.v14),
        .iOS(.v17),
    ],
    products: [
        .library(name: "OpenBrainKit", targets: ["OpenBrainKit"]),
    ],
    targets: [
        .target(name: "OpenBrainKit"),
        .testTarget(name: "OpenBrainKitTests", dependencies: ["OpenBrainKit"]),
    ]
)
