import AppKit
import SwiftUI

@main
struct ClawNexLauncherApp: App {
    var body: some Scene {
        MenuBarExtra("ClawNex Launcher", systemImage: "shield.lefthalf.filled") {
            LauncherView()
        }
        .menuBarExtraStyle(.window)
    }
}

@MainActor
final class LauncherStore: ObservableObject {
    @Published var snapshot: LauncherSnapshot?
    @Published var model = ""
    @Published var directory = FileManager.default.homeDirectoryForCurrentUser.path
    @Published var loading = false
    @Published var message = ""
    @Published var isError = false

    private var binary: String?

    init() {
        directory = UserDefaults.standard.string(forKey: "launcher.directory") ?? directory
        model = UserDefaults.standard.string(forKey: "launcher.model") ?? ""
        refresh()
    }

    func refresh() {
        loading = true
        message = ""
        isError = false
        Task {
            do {
                guard let found = LauncherCore.clawnexBinary() else { throw LauncherFailure.clawnexMissing }
                let value = try await Task.detached { try LauncherCore.snapshot(binary: found) }.value
                binary = found
                snapshot = value
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
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: directory)
        if panel.runModal() == .OK, let path = panel.url?.path {
            directory = path
            UserDefaults.standard.set(path, forKey: "launcher.directory")
        }
    }

    func selectModel(_ value: String) {
        model = value
        UserDefaults.standard.set(value, forKey: "launcher.model")
    }

    func launch(_ harness: LauncherHarness) {
        guard harness.installed, !model.isEmpty, let binary else { return }
        do {
            let command = LauncherCore.launchCommand(binary: binary, harness: harness.id, model: model, directory: directory)
            try LauncherCore.openTerminal(command: command)
            message = "Opened \(harness.label) in Terminal."
            isError = false
        } catch {
            message = error.localizedDescription
            isError = true
        }
    }
}

struct LauncherView: View {
    @StateObject private var store = LauncherStore()

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Image(systemName: "shield.lefthalf.filled").font(.title)
                VStack(alignment: .leading, spacing: 2) {
                    Text("ClawNex Launcher").font(.title2.bold())
                    Text("Inspected coding sessions").foregroundStyle(.secondary)
                }
                Spacer()
                Button { store.refresh() } label: { Image(systemName: "arrow.clockwise") }
                    .help("Refresh models and harnesses")
            }

            GroupBox("MODEL") {
                Picker("Model", selection: Binding(get: { store.model }, set: store.selectModel)) {
                    if store.snapshot?.models.isEmpty != false { Text("No loaded models").tag("") }
                    ForEach(store.snapshot?.models ?? []) { Text($0.name).tag($0.id) }
                }
                .labelsHidden()
                .frame(maxWidth: .infinity)
            }

            GroupBox("SESSION OPENS IN") {
                VStack(alignment: .leading, spacing: 10) {
                    Button(action: store.chooseDirectory) {
                        HStack {
                            Image(systemName: "folder")
                            Text(store.directory).lineLimit(1).truncationMode(.middle)
                            Spacer()
                        }
                    }
                    Picker("Terminal", selection: .constant("terminal")) {
                        Text("Automatic (Terminal)").tag("terminal")
                    }
                    .labelsHidden()
                }
            }

            GroupBox("CODING HARNESSES") {
                VStack(spacing: 4) {
                    ForEach(store.snapshot?.harnesses ?? []) { harness in
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
    }
}
