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
            case .auto:        "Auto-detect"
            case .observation: "Observation"
            case .task:        "Task"
            case .idea:        "Idea"
            case .reference:   "Reference"
            case .person_note: "Person note"
            }
        }

        var icon: String {
            switch self {
            case .auto:        "sparkles"
            case .observation: "eye"
            case .task:        "checkmark.circle"
            case .idea:        "lightbulb"
            case .reference:   "link"
            case .person_note: "person"
            }
        }

        var apiValue: String? {
            self == .auto ? nil : rawValue
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
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
        .background(Color.obSurface)
        .navigationTitle("Capture")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isCapturing { ProgressView().tint(.obPrimary) }
            }
        }
    }

    private var textEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Thought")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Color.obOnSurfaceVariant)
            TextEditor(text: $text)
                .frame(minHeight: 120)
                .foregroundStyle(Color.obOnSurface)
                .scrollContentBackground(.hidden)
                .background(Color.obSurfaceContainerLow)
                .focused($isTextFocused)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color.obOutlineVariant.opacity(0.15), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .onAppear { isTextFocused = true }
        }
    }

    private var typePicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Type")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Color.obOnSurfaceVariant)
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
        let isSelected = selectedType == type
        return Button {
            selectedType = type
        } label: {
            Label(type.label, systemImage: type.icon)
                .font(.system(size: 12, weight: .medium))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(isSelected ? Color.obSecondaryContainer : Color.obSurfaceContainerHigh)
                .foregroundStyle(isSelected ? Color.obOnSecondaryContainer : Color.obOnSurfaceVariant)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func confirmationBanner(_ message: String) -> some View {
        Label(message, systemImage: "checkmark.circle.fill")
            .font(.subheadline)
            .foregroundStyle(Color.obSecondary)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.obSecondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func errorBanner(_ message: String) -> some View {
        Label(message, systemImage: "exclamationmark.triangle")
            .font(.subheadline)
            .foregroundStyle(Color.obError)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.obErrorContainer.opacity(0.3))
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private var captureButton: some View {
        Button {
            capture()
        } label: {
            Label("Capture Thought", systemImage: "plus.circle.fill")
                .font(.system(.subheadline, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(LinearGradient.obPrimaryGradient)
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isCapturing)
        .opacity({
            let isEmpty = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            return isEmpty || isCapturing ? 0.5 : 1
        }())
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
