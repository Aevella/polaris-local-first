import Capacitor
import Foundation

@objc(NativeProviderHttpPlugin)
public class NativeProviderHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeProviderHttpPlugin"
    public let jsName = "NativeProviderHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private var requests: [String: NativeProviderHttpRequest] = [:]
    private let requestsLock = NSLock()

    @objc public func start(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId"), !requestId.isEmpty,
              let urlText = call.getString("url"), let url = URL(string: urlText),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let body = call.getString("body") else {
            call.reject("模型请求参数不完整。")
            return
        }

        let headers = (call.getObject("headers") ?? [:]).reduce(into: [String: String]()) { result, entry in
            if let value = entry.value as? String {
                result[entry.key] = value
            }
        }
        let requestToken = UUID()
        let request = NativeProviderHttpRequest(
            token: requestToken,
            url: url,
            headers: headers,
            body: body,
            startCall: call,
            emit: { [weak self] type, payload in
                var event: [String: Any] = [
                    "requestId": requestId,
                    "type": type
                ]
                payload.forEach { event[$0.key] = $0.value }
                self?.notifyListeners("event", data: event)
            },
            didFinish: { [weak self] token in
                self?.removeRequest(requestId, matching: token)
            }
        )

        requestsLock.lock()
        let previous = requests.updateValue(request, forKey: requestId)
        requestsLock.unlock()
        previous?.cancel()
        request.start()
    }

    @objc public func cancel(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId"), !requestId.isEmpty else {
            call.reject("缺少模型请求标识。")
            return
        }
        removeRequest(requestId)?.cancel()
        call.resolve()
    }

    deinit {
        requestsLock.lock()
        let activeRequests = Array(requests.values)
        requests.removeAll()
        requestsLock.unlock()
        activeRequests.forEach { $0.cancel() }
    }

    @discardableResult
    private func removeRequest(_ requestId: String) -> NativeProviderHttpRequest? {
        requestsLock.lock()
        let request = requests.removeValue(forKey: requestId)
        requestsLock.unlock()
        return request
    }

    private func removeRequest(_ requestId: String, matching token: UUID) {
        requestsLock.lock()
        if requests[requestId]?.token == token {
            requests.removeValue(forKey: requestId)
        }
        requestsLock.unlock()
    }
}

private final class NativeProviderHttpRequest: NSObject, URLSessionDataDelegate {
    let token: UUID
    private let url: URL
    private let headers: [String: String]
    private let body: String
    private let startCall: CAPPluginCall
    private let emit: (String, [String: Any]) -> Void
    private let didFinish: (UUID) -> Void
    private let delegateQueue: OperationQueue
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var responseResolved = false
    private var closed = false

    init(
        token: UUID,
        url: URL,
        headers: [String: String],
        body: String,
        startCall: CAPPluginCall,
        emit: @escaping (String, [String: Any]) -> Void,
        didFinish: @escaping (UUID) -> Void
    ) {
        self.token = token
        self.url = url
        self.headers = headers
        self.body = body
        self.startCall = startCall
        self.emit = emit
        self.didFinish = didFinish
        self.delegateQueue = OperationQueue()
        self.delegateQueue.maxConcurrentOperationCount = 1
        super.init()
    }

    func start() {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = body.data(using: .utf8)
        request.timeoutInterval = TimeInterval.greatestFiniteMagnitude
        headers.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = TimeInterval.greatestFiniteMagnitude
        configuration.timeoutIntervalForResource = TimeInterval.greatestFiniteMagnitude
        configuration.waitsForConnectivity = true
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue)
        self.session = session
        self.task = session.dataTask(with: request)
        task?.resume()
    }

    func cancel() {
        guard !closed else { return }
        closed = true
        task?.cancel()
        session?.invalidateAndCancel()
        didFinish(token)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard !closed, let httpResponse = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            if !closed { fail("模型服务没有返回 HTTP 响应。") }
            return
        }
        responseResolved = true
        DispatchQueue.main.async {
            self.startCall.resolve([
                "status": httpResponse.statusCode,
                "contentType": httpResponse.value(forHTTPHeaderField: "Content-Type") ?? ""
            ])
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !closed, !data.isEmpty else { return }
        let encoded = data.base64EncodedString()
        DispatchQueue.main.async {
            self.emit("chunk", ["data": encoded])
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard !closed else { return }
        if let error {
            fail("原生模型网络请求失败：\(error.localizedDescription)")
            return
        }
        closed = true
        session.finishTasksAndInvalidate()
        DispatchQueue.main.async {
            self.emit("complete", [:])
            self.didFinish(self.token)
        }
    }

    private func fail(_ message: String) {
        guard !closed else { return }
        closed = true
        task?.cancel()
        session?.invalidateAndCancel()
        DispatchQueue.main.async {
            if self.responseResolved {
                self.emit("error", ["message": message])
            } else {
                self.startCall.reject(message)
            }
            self.didFinish(self.token)
        }
    }
}
