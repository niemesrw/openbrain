import SwiftUI
import OpenBrainKit

struct MainView: View {
    let authService: AuthService
    @State private var selectedSection: SidebarSection = .brain

    var body: some View {
        NavigationSplitView {
            SidebarView(selection: $selectedSection)
                .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 260)
        } detail: {
            detailPanel
        }
    }

    @ViewBuilder
    private var detailPanel: some View {
        switch selectedSection {
        case .brain:
            BrainPanel()
        case .settings:
            SettingsPanel(authService: authService)
        }
    }
}

enum SidebarSection: String, CaseIterable, Identifiable {
    case brain = "Brain"
    case settings = "Settings"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .brain: "brain"
        case .settings: "gearshape"
        }
    }
}
