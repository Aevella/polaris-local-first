import UIKit
import Capacitor
import CapApp_SPM
import WebKit

private enum PolarisWebViewCacheInvalidator {
    private static let lastClearedBuildKey = "polaris.webviewCacheLastClearedBuild"

    static func clearIfBinaryChanged() {
        guard let currentBuild = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String,
              !currentBuild.isEmpty else {
            return
        }

        let defaults = UserDefaults.standard
        guard defaults.string(forKey: lastClearedBuildKey) != currentBuild else {
            return
        }

        let cacheTypes: Set<String> = [
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache
        ]

        WKWebsiteDataStore.default().removeData(
            ofTypes: cacheTypes,
            modifiedSince: Date(timeIntervalSince1970: 0)
        ) {
            defaults.set(currentBuild, forKey: lastClearedBuildKey)
        }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        PolarisWebViewCacheInvalidator.clearIfBinaryChanged()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

@objc(AppBridgeViewController)
class AppBridgeViewController: CAPBridgeViewController {
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        #if targetEnvironment(simulator)
        let simulatorGlyphGuard = """
        window.__POLARIS_IOS_SIMULATOR__ = true;
        document.documentElement.dataset.polarisIosSimulator = 'true';
        if (window.top !== window) {
            (function () {
                var pattern = /[\\p{Extended_Pictographic}\\p{Emoji_Presentation}\\uFE0F]/u;
                var segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
                    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
                    : null;
                function pieces(value) {
                    return segmenter
                        ? Array.from(segmenter.segment(value), function (entry) { return entry.segment; })
                        : Array.from(value);
                }
                function clean(value) {
                    return pieces(value).filter(function (part) {
                        return !pattern.test(part);
                    }).join('').replace(/[ \\t]{2,}/g, ' ');
                }
                function cleanTextNode(node) {
                    var next = clean(node.nodeValue || '');
                    if (next !== node.nodeValue) node.nodeValue = next;
                }
                function cleanRoot(root) {
                    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                    var nodes = [];
                    while (walker.nextNode()) nodes.push(walker.currentNode);
                    nodes.forEach(cleanTextNode);
                }
                function start() {
                    cleanRoot(document.body || document.documentElement);
                    new MutationObserver(function (records) {
                        records.forEach(function (record) {
                            record.addedNodes.forEach(function (node) {
                                if (node.nodeType === Node.TEXT_NODE) {
                                    cleanTextNode(node);
                                } else if (node.nodeType === Node.ELEMENT_NODE) {
                                    cleanRoot(node);
                                }
                            });
                            if (record.type === 'characterData') cleanTextNode(record.target);
                        });
                    }).observe(document.documentElement, {
                        childList: true,
                        characterData: true,
                        subtree: true
                    });
                }
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', start, { once: true });
                } else {
                    start();
                }
            })();
        }
        """
        configuration.userContentController.addUserScript(
            WKUserScript(source: simulatorGlyphGuard, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        )
        #endif

        return super.webView(with: frame, configuration: configuration)
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()

        if bridge?.plugin(withName: "SystemFile") == nil {
            bridge?.registerPluginInstance(SystemFilePlugin())
        }

        if bridge?.plugin(withName: "WebDav") == nil {
            bridge?.registerPluginInstance(WebDavPlugin())
        }

        if bridge?.plugin(withName: "ScreenshotDebug") == nil {
            bridge?.registerPluginInstance(ScreenshotDebugPlugin())
        }

        if bridge?.plugin(withName: "NativePersistence") == nil {
            bridge?.registerPluginInstance(NativePersistencePlugin())
        }

        if bridge?.plugin(withName: "LocalDataSqlite") == nil {
            bridge?.registerPluginInstance(LocalDataSqlitePlugin())
        }

        if bridge?.plugin(withName: "PersonalData") == nil {
            bridge?.registerPluginInstance(PersonalDataPlugin())
        }

        if bridge?.plugin(withName: "NativeProviderHttp") == nil {
            bridge?.registerPluginInstance(NativeProviderHttpPlugin())
        }
    }
}
