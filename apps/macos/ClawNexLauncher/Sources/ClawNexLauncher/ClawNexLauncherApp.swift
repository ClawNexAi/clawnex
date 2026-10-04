import AppKit
import SwiftUI

enum LauncherTarget: String, CaseIterable, Identifiable {
    case local = "Local Mac"
    case ssh = "Remote over SSH"
    var id: String { rawValue }
}

@main
struct ClawNexLauncherApp: App {
    var body: some Scene {
        MenuBarExtra {
            LauncherView()
        } label: {
            Image(nsImage: BrandImages.menuBarIcon)
                .accessibilityLabel("ClawNex")
        }
        .menuBarExtraStyle(.window)
    }
}

enum BrandImages {
    static let appIcon: NSImage = load("ClawNexIcon") ?? NSImage(systemSymbolName: "shield.lefthalf.filled", accessibilityDescription: "ClawNex")!
    static let menuBarIcon: NSImage = {
        let image = (load("ClawNexMenuBarIcon") ?? appIcon).copy() as! NSImage
        image.size = NSSize(width: 16, height: 16)
        image.isTemplate = true
        return image
    }()

    private static func load(_ name: String) -> NSImage? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "png") else { return nil }
        return NSImage(contentsOf: url)
    }
}

@MainActor
final class LauncherStore: ObservableObject {
    @Published var snapshot: LauncherSnapshot?
    @Published var model = ""
    @Published var directory = FileManager.default.homeDirectoryForCurrentUser.path
    @Published var target = LauncherTarget.local
    @Published var remoteHost = ""
    @Published var terminal = LauncherTerminal.automatic
    @Published var availableTerminals = LauncherCore.availableTerminals()
    @Published var loading = false
    @Published var message = ""
    @Published var isError = false

    private var binary: String?

    init() {
        model = UserDefaults.standard.string(forKey: "launcher.model") ?? ""
        remoteHost = UserDefaults.standard.string(forKey: "launcher.remoteHost") ?? ""
        target = LauncherTarget(rawValue: UserDefaults.standard.string(forKey: "launcher.target") ?? "") ?? (remoteHost.isEmpty ? .local : .ssh)
        terminal = LauncherTerminal(rawValue: UserDefaults.standard.string(forKey: "launcher.terminal") ?? "") ?? .automatic
        directory = savedDirectory(for: target)
        refresh()
    }

    private func directoryKey(for value: LauncherTarget) -> String { "launcher.directory.\(value.id)" }

    private func savedDirectory(for value: LauncherTarget) -> String {
        if let saved = UserDefaults.standard.string(forKey: directoryKey(for: value)), !saved.isEmpty, saved != "." { return saved }
        return value == .local ? FileManager.default.homeDirectoryForCurrentUser.path : ""
    }

    func saveDirectory(_ value: String) {
        directory = value
        UserDefaults.standard.set(value, forKey: directoryKey(for: target))
    }

    func refresh() {
        loading = true
        message = ""
        isError = false
        Task {
            do {
                let selectedTarget = target
                let selectedHost = remoteHost.trimmingCharacters(in: .whitespacesAndNewlines)
                let found = selectedTarget == .local ? LauncherCore.clawnexBinary() : nil
                if selectedTarget == .local && found == nil { throw LauncherFailure.clawnexMissing }
                let value = try await Task.detached {
                    try LauncherCore.snapshot(binary: found, remoteHost: selectedTarget == .ssh ? selectedHost : nil)
                }.value
                binary = found
                snapshot = value
                availableTerminals = LauncherCore.availableTerminals()
                if !availableTerminals.contains(terminal) { terminal = .automatic }
                if selectedTarget == .ssh, directory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                   let home = value.homeDirectory, !home.isEmpty {
                    saveDirectory(home)
                }
                if !value.models.contains(where: { $0.id == model }) { model = value.models.first?.id ?? "" }
                UserDefaults.standard.set(model, forKey: "launcher.model")
            } catch {
                message = error.localizedDescription
                isError = true
            }
            loading = false
        }
    }

    func chooseDirectory() {
        guard target == .local else { return }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: directory)
        if panel.runModal() == .OK, let path = panel.url?.path {
            directory = path
            saveDirectory(path)
        }
    }

    func selectTarget(_ value: LauncherTarget) {
        target = value
        directory = savedDirectory(for: value)
        UserDefaults.standard.set(value.rawValue, forKey: "launcher.target")
        snapshot = nil
        refresh()
    }

    func saveRemoteHost(_ value: String) {
        remoteHost = value
        UserDefaults.standard.set(value, forKey: "launcher.remoteHost")
    }

    func selectModel(_ value: String) {
        model = value
        UserDefaults.standard.set(value, forKey: "launcher.model")
    }

    func selectTerminal(_ value: LauncherTerminal) {
        terminal = value
        UserDefaults.standard.set(value.rawValue, forKey: "launcher.terminal")
    }

    func launch(_ harness: LauncherHarness) {
        guard harness.installed, !model.isEmpty else { return }
        do {
            let command: String
            if target == .ssh {
                command = try LauncherCore.remoteLaunchCommand(remoteHost: remoteHost.trimmingCharacters(in: .whitespacesAndNewlines), harness: harness.id, model: model, directory: directory)
            } else {
                guard let binary else { throw LauncherFailure.clawnexMissing }
                command = LauncherCore.launchCommand(binary: binary, harness: harness.id, model: model, directory: directory)
            }
            let resolvedTerminal = LauncherCore.resolvedTerminal(terminal, available: availableTerminals)
            try LauncherCore.openTerminal(command: command, terminal: terminal, available: availableTerminals)
            message = "Opened \(harness.label) in \(resolvedTerminal.label)."
            isError = false
        } catch {
            message = error.localizedDescription
            isError = true
        }
    }
}

struct LauncherView: View {
    @StateObject private var store = LauncherStore()
    private let brand = Color(red: 0.0, green: 0.86, blue: 0.68)

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Image(nsImage: BrandImages.appIcon)
                    .resizable().scaledToFit().frame(width: 34, height: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text("ClawNex Launcher").font(.title2.bold())
                    Text("Inspected coding sessions").foregroundStyle(.secondary)
                }
                Spacer()
                Button { store.refresh() } label: { Image(systemName: "arrow.clockwise") }
                    .help("Refresh models and harnesses")
            }

            GroupBox("CLAWNEX TARGET") {
                VStack(alignment: .leading, spacing: 8) {
                    Picker("Target", selection: Binding(get: { store.target }, set: store.selectTarget)) {
                        ForEach(LauncherTarget.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .labelsHidden()
                    if store.target == .ssh {
                        TextField("operator@clawnex-host", text: Binding(get: { store.remoteHost }, set: store.saveRemoteHost))
                            .textFieldStyle(.roundedBorder)
                            .onSubmit { store.refresh() }
                    }
                }
            }

            GroupBox("MODEL") {
                Picker("Model", selection: Binding(get: { store.model }, set: store.selectModel)) {
                    if store.snapshot?.models.isEmpty != false { Text("No loaded models").tag("") }
                    ForEach(store.snapshot?.models ?? []) { Text($0.name).tag($0.id) }
                }
                .labelsHidden()
                .frame(maxWidth: .infinity)
            }
            .background(RoundedRectangle(cornerRadius: 8).fill(brand.opacity(0.07)))

            GroupBox("SESSION STARTS IN") {
                VStack(alignment: .leading, spacing: 10) {
                    if store.target == .local {
                        Button(action: store.chooseDirectory) {
                            HStack {
                                Image(systemName: "folder")
                                Text(store.directory).lineLimit(1).truncationMode(.middle)
                                Spacer()
                            }
                        }
                    } else {
                        TextField(store.snapshot?.homeDirectory ?? "/home/operator", text: Binding(get: { store.directory }, set: store.saveDirectory))
                            .textFieldStyle(.roundedBorder)
                    }
                    Text("Working directory for the new coding session.")
                        .font(.caption).foregroundStyle(.secondary)
                    Picker("Terminal", selection: Binding(get: { store.terminal }, set: store.selectTerminal)) {
                        ForEach(store.availableTerminals) { terminal in
                            let resolved = LauncherCore.resolvedTerminal(terminal, available: store.availableTerminals)
                            Text(terminal == .automatic ? "Automatic (\(resolved.label))" : terminal.label).tag(terminal)
                        }
                    }
                    .labelsHidden()
                }
            }

            GroupBox("CODING HARNESSES") {
                VStack(spacing: 4) {
                    let installedHarnesses = (store.snapshot?.harnesses ?? []).filter(\.installed)
                    if installedHarnesses.isEmpty {
                        Text("No supported coding harnesses were found on this target.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    ForEach(installedHarnesses) { harness in
                        Button { store.launch(harness) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "terminal")
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(harness.label).font(.headline)
                                    Text(harness.installed ? harness.protocolName : "not installed")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(harness.protocolName).font(.caption).foregroundStyle(.secondary)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(!harness.installed || store.model.isEmpty)
                        .opacity(harness.installed ? 1 : 0.45)
                        .padding(.vertical, 6)
                    }
                }
            }

            if store.loading { ProgressView().controlSize(.small) }
            if !store.message.isEmpty {
                Text(store.message).font(.caption).foregroundStyle(store.isError ? Color.red : Color.secondary)
                    .textSelection(.enabled)
            }

            HStack {
                Text("No provider credentials are stored in this app.").font(.caption2).foregroundStyle(.secondary)
                Spacer()
                Button("Quit") { NSApplication.shared.terminate(nil) }
            }
        }
        .padding(18)
        .frame(width: 420)
        .tint(brand)
    }
}
