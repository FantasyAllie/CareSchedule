import SwiftUI

// The rota itself is CareSchedule.html (the same file the desktop app and browsers use),
// shown full screen. Everything native lives in RotaViewController.swift.
@main
struct CareScheduleApp: App {
    var body: some Scene {
        WindowGroup {
            RotaView()
                .ignoresSafeArea(.container, edges: .bottom)
        }
    }
}

struct RotaView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> RotaViewController { RotaViewController() }
    func updateUIViewController(_ controller: RotaViewController, context: Context) {}
}
