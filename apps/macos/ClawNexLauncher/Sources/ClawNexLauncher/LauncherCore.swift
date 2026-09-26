import AppKit
import Foundation

struct LauncherSnapshot: Decodable {
    let schemaVersion: Int
    let product: String
    let models: [LauncherModel]
    let harnesses: [LauncherHarness]
}

struct LauncherModel: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
}

struct LauncherHarness: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
    let protocolName: String
    let installed: Bool

    enum CodingKeys: String, CodingKey {
        case id, label, installed
        case protocolName = "protocol"
    }
}

enum LauncherFailure: LocalizedError {
    case clawnexMissing
    case commandFailed(String)
    case invalidSnapshot

    var errorDescription: String? {
        switch self {
        case .clawnexMissing: return "ClawNex CLI was not found. Install ClawNex or add clawnex to ~/.local/bin."
        case .commandFailed(let message): return message
        case .invalidSnapshot: return "ClawNex returned an unsupported launcher snapshot."
        }
    }
}

enum LauncherCore {
    static func clawnexBinary(environment: [String: String] = ProcessInfo.processInfo.environment) -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let pathCandidates = (environment["PATH"] ?? "").split(separator: ":").map { String($0) + "/clawnex" }
        let candidates = [
            home + "/.local/bin/clawnex",
            "/opt/homebrew/bin/clawnex",
            "/usr/local/bin/clawnex",
        ] + pathCandidates
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    static func snapshot(binary: String) throws -> LauncherSnapshot {
        let result = try run(binary, ["launcher", "snapshot", "--json"])
        guard result.status == 0 else {
            throw LauncherFailure.commandFailed(result.error.isEmpty ? "Unable to read ClawNex launcher state." : result.error)
        }
        let decoder = JSONDecoder()
        guard let value = try? decoder.decode(LauncherSnapshot.self, from: result.output), value.schemaVersion == 1 else {
            throw LauncherFailure.invalidSnapshot
        }
        return value
    }

    static func launchCommand(binary: String, harness: String, model: String, directory: String) -> String {
        "cd \(shellQuote(directory)) && exec \(shellQuote(binary)) run \(shellQuote(harness)) --model \(shellQuote(model))"
    }

    static func openTerminal(command: String) throws {
        let escaped = command.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        let script = "tell application \"Terminal\" to do script \"\(escaped)\"\ntell application \"Terminal\" to activate"
        let result = try run("/usr/bin/osascript", ["-e", script])
        guard result.status == 0 else {
            throw LauncherFailure.commandFailed(result.error.isEmpty ? "Terminal did not accept the launch command." : result.error)
        }
    }

    static func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
    }

    private static func run(_ executable: String, _ arguments: [String]) throws -> (status: Int32, output: Data, error: String) {
        let process = Process()
        let stdout = Pipe()
        let stderr = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = stdout
        process.standardError = stderr
        try process.run()
        process.waitUntilExit()
        let output = stdout.fileHandleForReading.readDataToEndOfFile()
        let errorData = stderr.fileHandleForReading.readDataToEndOfFile()
        return (process.terminationStatus, output, String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")
    }
}
