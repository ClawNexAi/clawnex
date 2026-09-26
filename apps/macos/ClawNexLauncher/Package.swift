// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ClawNexLauncher",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "ClawNexLauncher", targets: ["ClawNexLauncher"])],
    targets: [.executableTarget(name: "ClawNexLauncher")]
)
