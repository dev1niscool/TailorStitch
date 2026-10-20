import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    #if DEBUG
    private var stitchSmokeCheck: StitchSmokeCheck?
    #endif

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        let bridgeController = CAPBridgeViewController()
        window?.rootViewController = bridgeController
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)

        #if DEBUG
        if ProcessInfo.processInfo.environment["TAILORSTITCH_SMOKE_TEST"] == "1" {
            stitchSmokeCheck = StitchSmokeCheck(controller: bridgeController)
            stitchSmokeCheck?.start()
        }
        #endif
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

#if DEBUG
/// Exercises the actual bundled web app in WKWebView on CI. Excluded from Release.
/// Only a simulator launch environment variable enables this check.
private final class StitchSmokeCheck {
    private weak var controller: CAPBridgeViewController?
    private let deadline = Date().addingTimeInterval(90)
    private var latestState: [String: Any] = [:]

    init(controller: CAPBridgeViewController) {
        self.controller = controller
    }

    func start() {
        poll()
    }

    private func poll() {
        guard Date() < deadline else {
            finish(success: false, error: "The native demo did not finish within 90 seconds.")
            return
        }
        guard let webView = controller?.webView else {
            scheduleNextPoll()
            return
        }
        let script = """
        (() => {
          const button = document.getElementById('demo-button');
          if (!button || document.readyState !== 'complete') return { ready: false };
          if (!window.__tailorstitchNativeSmokeStarted) {
            window.__tailorstitchNativeSmokeStarted = true;
            button.click();
          }
          const canvas = document.getElementById('output-canvas');
          const save = document.getElementById('download-button');
          return {
            ready: true,
            platform: window.Capacitor.getPlatform(),
            scheme: location.protocol,
            width: canvas?.width || 0,
            height: canvas?.height || 0,
            sourceCount: Number(document.getElementById('image-count')?.textContent || '0'),
            canSave: !!save && !save.disabled,
            notice: document.getElementById('notice')?.textContent || '',
            status: document.getElementById('result-status')?.textContent || ''
          };
        })()
        """
        webView.evaluateJavaScript(script) { [weak self] result, error in
            guard let self = self else { return }
            if let error = error {
                self.latestState["javascriptError"] = error.localizedDescription
            }
            if let state = result as? [String: Any] {
                self.latestState = state
                if state["canSave"] as? Bool == true {
                    let valid = state["width"] as? Int == 420
                        && state["height"] as? Int == 1580
                        && state["sourceCount"] as? Int == 3
                        && state["platform"] as? String == "ios"
                        && state["scheme"] as? String == "capacitor:"
                    self.finish(success: valid, error: valid ? nil : "The native demo produced an unexpected result.")
                    return
                }
            }
            self.scheduleNextPoll()
        }
    }

    private func scheduleNextPoll() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.poll()
        }
    }

    private func finish(success: Bool, error: String?) {
        var report = latestState
        report["success"] = success
        if let error = error { report["error"] = error }
        do {
            let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: directory.appendingPathComponent("tailorstitch-smoke.json"), options: .atomic)
        } catch {
            NSLog("TailorStitch smoke report could not be written: %@", error.localizedDescription)
        }
    }
}
#endif
