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
        case .capture:
            CapturePanel()
        case .search:
            SearchPanel()
        case .browse:
            BrowsePanel()
        case .stats:
            StatsPanel()
        case .settings:
            SettingsPanel(authService: authService)
        }
    }
}

enum SidebarSection: String, CaseIterable, Identifiable {
    case brain = "Brain"
    case capture = "Capture"
    case search = "Search"
    case browse = "Browse"
    case stats = "Stats"
    case settings = "Settings"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .brain: "brain"
        case .capture: "plus.circle"
        case .search: "magnifyingglass"
        case .browse: "list.bullet"
        case .stats: "chart.bar"
        case .settings: "gearshape"
        }
    }
}
