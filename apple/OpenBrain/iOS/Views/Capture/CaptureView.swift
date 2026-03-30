import SwiftUI
import OpenBrainKit

struct CaptureView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var selectedType: ThoughtType = .auto
    @State private var isCapturing = false
    @State private var confirmation: String?
    @State private var error: String?
    @FocusState private var isTextFocused: Bool

    enum ThoughtType: String, CaseIterable {
        case auto = "Auto"
        case observation
        case task
        case idea
        case reference
        case person_note = "person_note"

        var label: String {
            switch self {
            case .auto: "Auto-detect"
            case .observation: "Observation"
            case .task: "Task"
            case .idea: "Idea"
            case .reference: "Reference"
            case .person_note: "Person note"
            }
        }

        var icon: String {
            switch self {
            case .auto: "sparkles"
            case .observation: "eye"
            case .task: "checkmark.circle"
            case .idea: "lightbulb"
            case .reference: "link"
            case .person_note: "person"
            }
        }

        var apiValue: String? {
            self == .auto ? nil : rawValue
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                textEditor
                typePicker
                if let confirmation {
                    confirmationBanner(confirmation)
                }
                if let error {
                    errorBanner(error)
                }
                captureButton
            }
            .padding()
        }
        .navigationTitle("Capture")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isCapturing { ProgressView() }
            }
        }
    }

    private var textEditor: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Thought")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextEditor(text: $text)
                .frame(minHeight: 120)
                .focused($isTextFocused)
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color.secondary.opacity(0.3), lineWidth: 1)
                )
                .onAppear { isTextFocused = true }
        }
    }

    private var typePicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Type")
                .font(.caption)
                .foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(ThoughtType.allCases, id: \.self) { type in
                        typeChip(type)
                    }
                }
            }
        }
    }

    private func typeChip(_ type: ThoughtType) -> some View {
        Button {
            selectedType = type
        } label: {
            Label(type.label, systemImage: type.icon)
                .font(.caption)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(selectedType == type ? Color.purple : Color.secondary.opacity(0.15))
                .foregroundStyle(selectedType == type ? .white : .primary)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func confirmationBanner(_ message: String) -> some View {
        Label(message, systemImage: "checkmark.circle.fill")
            .font(.subheadline)
            .foregroundStyle(.green)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.green.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func errorBanner(_ message: String) -> some View {
        Label(message, systemImage: "exclamationmark.triangle")
            .font(.subheadline)
            .foregroundStyle(.red)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.red.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private var captureButton: some View {
        Button {
            capture()
        } label: {
            Label("Capture Thought", systemImage: "plus.circle.fill")
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
        }
        .buttonStyle(.borderedProminent)
        .tint(.purple)
        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isCapturing)
    }

    private func capture() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isCapturing = true
        confirmation = nil
        error = nil
        isTextFocused = false
        Task {
            do {
                let result = try await BrainService.captureThought(text: trimmed, type: selectedType.apiValue)
                confirmation = result.first?.text ?? "Captured"
                try? await Task.sleep(for: .milliseconds(600))
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            isCapturing = false
        }
    }
}
