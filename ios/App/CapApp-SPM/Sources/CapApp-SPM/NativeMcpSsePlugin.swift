import Capacitor
import Foundation

@objc(NativeMcpSsePlugin)
public class NativeMcpSsePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeMcpSsePlugin"
    public let jsName = "NativeMcpSse"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
    ]

    private var connections: [String: NativeMcpSseConnection] = [:]
    private let connectionsLock = NSLock()

    @objc public func open(_ call: CAPPluginCall) {
        guard let connectionId = call.getString("connectionId"), !connectionId.isEmpty,
              let urlText = call.getString("url"), let url = URL(string: urlText),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            call.reject("MCP SSE 地址不正确。")
            return
        }

        let timeoutMs = max(1, call.getInt("timeoutMs") ?? 30_000)
        let headers = (call.getObject("headers") ?? [:]).reduce(into: [String: String]()) { result, entry in
            if let value = entry.value as? String {
                result[entry.key] = value
            }
        }
        let connection = NativeMcpSseConnection(
            url: url,
            headers: headers,
            timeoutMs: timeoutMs,
            openCall: call,
            emitEvent: { [weak self] event, data in
                self?.notifyListeners("event", data: [
                    "connectionId": connectionId,
                    "event": event,
                    "data": data
                ])
            },
            emitError: { [weak self] message in
                self?.notifyListeners("error", data: [
                    "connectionId": connectionId,
                    "message": message
                ])
            },
            didClose: { [weak self] in
                self?.removeConnection(connectionId)
            }
        )

        connectionsLock.lock()
        let previous = connections.updateValue(connection, forKey: connectionId)
        connectionsLock.unlock()
        previous?.close()
        connection.start()
    }

    @objc public func close(_ call: CAPPluginCall) {
        guard let connectionId = call.getString("connectionId"), !connectionId.isEmpty else {
            call.reject("缺少 MCP SSE 连接标识。")
            return
        }
        removeConnection(connectionId)?.close()
        call.resolve()
    }

    deinit {
        connectionsLock.lock()
        let activeConnections = Array(connections.values)
        connections.removeAll()
        connectionsLock.unlock()
        activeConnections.forEach { $0.close() }
    }

    @discardableResult
    private func removeConnection(_ connectionId: String) -> NativeMcpSseConnection? {
        connectionsLock.lock()
        let connection = connections.removeValue(forKey: connectionId)
        connectionsLock.unlock()
        return connection
    }
}

private final class NativeMcpSseConnection: NSObject, URLSessionDataDelegate {
    private let url: URL
    private let headers: [String: String]
    private let timeoutMs: Int
    private let openCall: CAPPluginCall
    private let emitEvent: (String, String) -> Void
    private let emitError: (String) -> Void
    private let didClose: () -> Void
    private let delegateQueue: OperationQueue
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var timeoutWorkItem: DispatchWorkItem?
    private var buffer = ""
    private var endpointResolved = false
    private var closed = false

    init(
        url: URL,
        headers: [String: String],
        timeoutMs: Int,
        openCall: CAPPluginCall,
        emitEvent: @escaping (String, String) -> Void,
        emitError: @escaping (String) -> Void,
        didClose: @escaping () -> Void
    ) {
        self.url = url
        self.headers = headers
        self.timeoutMs = timeoutMs
        self.openCall = openCall
        self.emitEvent = emitEvent
        self.emitError = emitError
        self.didClose = didClose
        self.delegateQueue = OperationQueue()
        self.delegateQueue.maxConcurrentOperationCount = 1
        super.init()
    }

    func start() {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        // This is a persistent event channel, not one tool invocation. The
        // endpoint timer below and shared RPC deadlines own bounded waits.
        request.timeoutInterval = TimeInterval.greatestFiniteMagnitude
        headers.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = TimeInterval.greatestFiniteMagnitude
        configuration.timeoutIntervalForResource = TimeInterval.greatestFiniteMagnitude
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue)
        self.session = session
        self.task = session.dataTask(with: request)

        let timeout = DispatchWorkItem { [weak self] in
            guard let self, !self.endpointResolved, !self.closed else { return }
            self.fail("等待 MCP SSE 服务下发 endpoint 超时（\(Int(ceil(Double(self.timeoutMs) / 1000))) 秒）。")
        }
        timeoutWorkItem = timeout
        DispatchQueue.global(qos: .utility).asyncAfter(
            deadline: .now() + .milliseconds(timeoutMs),
            execute: timeout
        )
        task?.resume()
    }

    func close() {
        guard !closed else { return }
        closed = true
        timeoutWorkItem?.cancel()
        task?.cancel()
        session?.invalidateAndCancel()
        didClose()
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let httpResponse = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            fail("MCP SSE 服务没有返回 HTTP 响应。")
            return
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            completionHandler(.cancel)
            fail("连接 MCP SSE 服务失败：HTTP \(httpResponse.statusCode)")
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !closed else { return }
        buffer += String(decoding: data, as: UTF8.self).replacingOccurrences(of: "\r\n", with: "\n")
        while let range = buffer.range(of: "\n\n") {
            let block = String(buffer[..<range.lowerBound])
            buffer = String(buffer[range.upperBound...])
            dispatch(block)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if closed { return }
        if let error {
            fail("MCP SSE 连接中断：\(error.localizedDescription)")
            return
        }
        fail("MCP SSE 连接已结束。")
    }

    private func dispatch(_ block: String) {
        var eventName = "message"
        var dataLines: [String] = []
        for line in block.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix(":") { continue }
            if line.hasPrefix("event:") {
                eventName = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                if eventName.isEmpty { eventName = "message" }
            } else if line.hasPrefix("data:") {
                dataLines.append(String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces))
            }
        }
        guard !dataLines.isEmpty else { return }
        let data = dataLines.joined(separator: "\n")

        if eventName == "endpoint", !endpointResolved {
            guard let endpoint = URL(string: data, relativeTo: url)?.absoluteURL.absoluteString else {
                fail("MCP SSE 服务下发了无法识别的 endpoint。")
                return
            }
            endpointResolved = true
            timeoutWorkItem?.cancel()
            DispatchQueue.main.async {
                self.openCall.resolve(["endpoint": endpoint])
            }
            return
        }

        DispatchQueue.main.async {
            self.emitEvent(eventName, data)
        }
    }

    private func fail(_ message: String) {
        guard !closed else { return }
        closed = true
        timeoutWorkItem?.cancel()
        task?.cancel()
        session?.invalidateAndCancel()
        DispatchQueue.main.async {
            if self.endpointResolved {
                self.emitError(message)
            } else {
                self.openCall.reject(message)
            }
            self.didClose()
        }
    }
}
