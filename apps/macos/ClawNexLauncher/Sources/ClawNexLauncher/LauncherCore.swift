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
    case invalidRemoteHost
    case commandFailed(String)
    case invalidSnapshot

    var errorDescription: String? {
        switch self {
        case .clawnexMissing: return "ClawNex CLI was not found. Install ClawNex or add clawnex to ~/.local/bin."
        case .invalidRemoteHost: return "Enter an SSH target such as operator@clawnex-host."
        case .commandFailed(let message): return message
        case .invalidSnapshot: return "ClawNex returned an unsupported launcher snapshot."
        }
    }
}

enum LauncherCore {
    static func clawnexBinary(environment: [String: String] = ProcessInfo.processInfo.environment) -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let pathCandidates = executionPath(environment: environment).split(separator: ":").map { String($0) + "/clawnex" }
        let candidates = [
            home + "/.local/bin/clawnex",
            "/opt/homebrew/bin/clawnex",
            "/usr/local/bin/clawnex",
        ] + pathCandidates
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    static func snapshot(binary: String? = nil, remoteHost: String? = nil) throws -> LauncherSnapshot {
        let result: (status: Int32, output: Data, error: String)
        if let remoteHost {
            guard validRemoteHost(remoteHost) else { throw LauncherFailure.invalidRemoteHost }
            result = try run("/usr/bin/ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", remoteHost,
                                                  "$HOME/.local/bin/clawnex", "launcher", "snapshot", "--json"])
        } else {
            guard let binary else { throw LauncherFailure.clawnexMissing }
            result = try run(binary, ["launcher", "snapshot", "--json"])
        }
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
        let pathValue = executionPath()
        return "cd \(shellQuote(directory)) && exec /usr/bin/env PATH=\(shellQuote(pathValue)) \(shellQuote(binary)) run \(shellQuote(harness)) --model \(shellQuote(model))"
    }

    static func remoteLaunchCommand(remoteHost: String, harness: String, model: String, directory: String) throws -> String {
        guard validRemoteHost(remoteHost) else { throw LauncherFailure.invalidRemoteHost }
        let remote = "cd \(shellQuote(directory)) && exec $HOME/.local/bin/clawnex run \(shellQuote(harness)) --model \(shellQuote(model))"
        return "exec /usr/bin/ssh -t \(shellQuote(remoteHost)) \(shellQuote(remote))"
    }

    static func validRemoteHost(_ value: String) -> Bool {
        !value.isEmpty && value.range(of: #"^[A-Za-z0-9._@:-]+$"#, options: .regularExpression) != nil
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

    static func executionPath(environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            home + "/.npm-global/bin",
            home + "/.local/bin",
            home + "/.bun/bin",
            home + "/.cargo/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ] + (environment["PATH"] ?? "").split(separator: ":").map(String.init)
        return candidates.reduce(into: [String]()) { result, value in
            if !value.isEmpty, !result.contains(value) { result.append(value) }
        }.joined(separator: ":")
    }

    private static func run(_ executable: String, _ arguments: [String]) throws -> (status: Int32, output: Data, error: String) {
        let process = Process()
        let stdout = Pipe()
        let stderr = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.environment = ProcessInfo.processInfo.environment.merging(["PATH": executionPath()]) { _, replacement in replacement }
        process.standardOutput = stdout
        process.standardError = stderr
        try process.run()
        process.waitUntilExit()
        let output = stdout.fileHandleForReading.readDataToEndOfFile()
        let errorData = stderr.fileHandleForReading.readDataToEndOfFile()
        return (process.terminationStatus, output, String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")
    }
}
