import Capacitor
import CryptoKit
import Foundation

@objc(NativePersistencePlugin)
public class NativePersistencePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativePersistencePlugin"
    public let jsName = "NativePersistence"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readJsonChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginJsonWrite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendJsonWriteChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishJsonWrite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "delete", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "entries", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sizes", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keys", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keysWithPrefix", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "applyKvMutations", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "replaceKv", returnType: CAPPluginReturnPromise)
    ]
    private let maxEncodedKeyStemLength = 180
    private let maxLegacyFallbackStemLength = 245
    private let chunkedJsonBridgeThreshold = 256 * 1024

    @objc public func get(_ call: CAPPluginCall) {
        guard let request = readStoreKey(call) else { return }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.recoverInterruptedStoreReplacement(request.storeName)
                if let jsonUrl = self.existingJsonUrl(storeName: request.storeName, key: request.key) {
                    let fileSize = try jsonUrl.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    if fileSize > self.chunkedJsonBridgeThreshold {
                        let stats = try self.readJsonStats(jsonUrl)
                        try self.verifyJsonMetaStats(
                            stats,
                            payloadUrl: jsonUrl,
                            storeName: request.storeName,
                            key: request.key
                        )
                        DispatchQueue.main.async {
                            call.resolve([
                                "exists": true,
                                "key": request.key,
                                "kind": "json",
                                "readMode": "chunked",
                                "byteLength": stats.byteLength,
                                "checksum": stats.checksum
                            ])
                        }
                        return
                    }
                    let data = try Data(contentsOf: jsonUrl)
                    try self.verifyJsonMeta(data, storeName: request.storeName, key: request.key)
                    let jsonText = try self.jsonText(data)
                    DispatchQueue.main.async {
                        call.resolve([
                            "exists": true,
                            "key": request.key,
                            "kind": "json",
                            "jsonText": jsonText
                        ])
                    }
                    return
                }

                if let binaryUrl = self.existingBinaryUrl(storeName: request.storeName, key: request.key) {
                    let data = try Data(contentsOf: binaryUrl)
                    var result: [String: Any] = [
                        "exists": true,
                        "key": request.key,
                        "kind": "binary",
                        "dataBase64": data.base64EncodedString()
                    ]
                    if let mimeType = try? self.readMimeType(storeName: request.storeName, key: request.key), !mimeType.isEmpty {
                        result["mimeType"] = mimeType
                    }
                    DispatchQueue.main.async {
                        call.resolve(result)
                    }
                    return
                }

                DispatchQueue.main.async {
                    call.resolve(["exists": false])
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject(self.nativeFailureMessage("读取原生存储失败", error), nil, error)
                }
            }
        }
    }

    @objc public func readJsonChunk(_ call: CAPPluginCall) {
        guard let request = readStoreKey(call) else { return }
        guard let offset = callInt(call, "offset"), offset >= 0,
              let length = callInt(call, "length"), length > 0 else {
            call.reject("原生 JSON 读取分片范围不正确。")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.recoverInterruptedStoreReplacement(request.storeName)
                guard let jsonUrl = self.existingJsonUrl(storeName: request.storeName, key: request.key) else {
                    throw NativePersistenceError.invalidKey
                }
                let handle = try FileHandle(forReadingFrom: jsonUrl)
                defer { try? handle.close() }
                try handle.seek(toOffset: UInt64(offset))
                let data = try handle.read(upToCount: length) ?? Data()
                DispatchQueue.main.async {
                    call.resolve([
                        "chunkBase64": data.base64EncodedString(),
                        "byteLength": data.count
                    ])
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject(self.nativeFailureMessage("读取原生 JSON 分片失败", error), nil, error)
                }
            }
        }
    }

    @objc public func set(_ call: CAPPluginCall) {
        guard let request = readStoreKey(call) else { return }
        guard let kind = call.getString("kind") else {
            call.reject("缺少原生存储类型。")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.recoverInterruptedStoreReplacement(request.storeName)
                try self.ensureStoreDirectory(request.storeName)
                if kind == "binary" {
                    guard let dataBase64 = call.getString("dataBase64"), let data = Data(base64Encoded: dataBase64) else {
                        DispatchQueue.main.async {
                            call.reject("原生存储二进制内容格式不正确。")
                        }
                        return
                    }
                    guard let url = self.primaryBinaryUrl(storeName: request.storeName, key: request.key) else {
                        DispatchQueue.main.async {
                            call.reject("原生存储 key 不正确。")
                        }
                        return
                    }
                    try self.removeJsonValue(storeName: request.storeName, key: request.key)
                    try data.write(to: url, options: [.atomic])
                    try self.writeKeyMetaIfNeeded(storeName: request.storeName, key: request.key)
                    try self.writeMimeType(call.getString("mimeType") ?? "", storeName: request.storeName, key: request.key)
                } else if kind == "json" {
                    guard let url = self.primaryJsonUrl(storeName: request.storeName, key: request.key) else {
                        DispatchQueue.main.async {
                            call.reject("原生存储 key 不正确。")
                        }
                        return
                    }
                    let data = try self.jsonData(call)
                    try self.removeBinaryValue(storeName: request.storeName, key: request.key)
                    try data.write(to: url, options: [.atomic])
                    try self.writeJsonMeta(data, storeName: request.storeName, key: request.key)
                } else {
                    DispatchQueue.main.async {
                        call.reject("未知原生存储类型。")
                    }
                    return
                }

                DispatchQueue.main.async {
                    call.resolve()
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject(self.nativeFailureMessage("写入原生存储失败", error), nil, error)
                }
            }
        }
    }

    @objc public func beginJsonWrite(_ call: CAPPluginCall) {
        guard let request = readStoreKey(call) else { return }
        guard let writeId = call.getString("writeId"), isSafeWriteId(writeId) else {
            call.reject("原生 JSON 写入会话不正确。")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.recoverInterruptedStoreReplacement(request.storeName)
                try self.ensureStoreDirectory(request.storeName)
                let url = try self.jsonWriteTempUrl(storeName: request.storeName, key: request.key, writeId: writeId)
                if FileManager.default.fileExists(atPath: url.path) {
                    try FileManager.default.removeItem(at: url)
                }
                FileManager.default.createFile(atPath: url.path, contents: nil)
                DispatchQueue.main.async {
                    call.resolve()
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject(self.nativeFailureMessage("开始原生 JSON 分片写入失败", error), nil, error)
                }
            }
        }
    }

    @objc public func appendJsonWriteChunk(_ call: CAPPluginCall) {
        guard let request = readStoreKey(call) else { return }
        guard let writeId = call.getString("writeId"), isSafeWriteId(writeId),
              let chunkBase64 = call.getString("chunkBase64"),
              let data = Data(base64Encoded: chunkBase64) else {
            call.reject("原生 JSON 分片格式不正确。")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.recoverInterruptedStoreReplacement(request.storeName)
                let url = try self.jsonWriteTempUrl(storeName: request.storeName, key: request.key, writeId: writeId)
                let handle = try FileHandle(forWritingTo: url)
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
                try handle.close()
                DispatchQueue.main.async {
                    call.resolve()
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject(self.nativeFailureMessage("追加原生 JSON 分片失败", error), nil, error)
                }
            }
        }
    }

    @objc public func finishJsonWrite(_ call: CAPPluginCall) {
        guard let request = readStoreKey(call) else { return }
        guard let writeId = call.getString("writeId"), isSafeWriteId(writeId) else {
            call.reject("原生 JSON 写入会话不正确。")
            return
        }
        let expectedByteLength = callInt(call, "expectedByteLength")
        let expectedChecksum = call.getString("expectedChecksum")
        let chunkCount = callInt(call, "chunkCount")

        DispatchQueue.global(qos: .userInitiated).async {
            var tempUrl: URL?
            do {
                try self.recoverInterruptedStoreReplacement(request.storeName)
                let url = try self.jsonWriteTempUrl(storeName: request.storeName, key: request.key, writeId: writeId)
                tempUrl = url
                let data = try Data(contentsOf: url)
                let actualChecksum = self.fnv1a32Hex(data)
                let stats = self.jsonWriteStats(
                    actualByteLength: data.count,
                    actualChecksum: actualChecksum,
                    expectedByteLength: expectedByteLength,
                    expectedChecksum: expectedChecksum,
                    chunkCount: chunkCount
                )
                if let expectedByteLength, expectedByteLength != data.count {
                    throw NativePersistenceError.invalidPayloadDetail("原生 JSON 分片字节数不一致（\(stats)）。")
                }
                if let expectedChecksum, expectedChecksum != actualChecksum {
                    throw NativePersistenceError.invalidPayloadDetail("原生 JSON 分片校验值不一致（\(stats)）。")
                }
                guard let jsonUrl = self.primaryJsonUrl(storeName: request.storeName, key: request.key) else {
                    throw NativePersistenceError.invalidKey
                }
                try self.removeBinaryValue(storeName: request.storeName, key: request.key)
                try data.write(to: jsonUrl, options: [.atomic])
                try self.writeJsonMeta(data, storeName: request.storeName, key: request.key)
                try FileManager.default.removeItem(at: url)
                DispatchQueue.main.async {
                    call.resolve([
                        "byteLength": data.count,
                        "checksum": actualChecksum
                    ])
                }
            } catch {
                if let tempUrl, FileManager.default.fileExists(atPath: tempUrl.path) {
                    try? FileManager.default.removeItem(at: tempUrl)
                }
                DispatchQueue.main.async {
                    call.reject(self.nativeFailureMessage("完成原生 JSON 分片写入失败", error), nil, error)
                }
            }
        }
    }

    @objc public func delete(_ call: CAPPluginCall) {
        guard let request = readStoreKey(call) else { return }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.recoverInterruptedStoreReplacement(request.storeName)
                try self.removeJsonValue(storeName: request.storeName, key: request.key)
                try self.removeBinaryValue(storeName: request.storeName, key: request.key)
                DispatchQueue.main.async {
                    call.resolve()
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject(self.nativeFailureMessage("删除原生存储失败", error), nil, error)
                }
            }
        }
    }

    @objc public func entries(_ call: CAPPluginCall) {
        guard let storeName = call.getString("storeName"), isSafeStoreName(storeName) else {
            call.reject("原生存储 store 不正确。")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.recoverInterruptedStoreReplacement(storeName)
                let entries = try self.readEntries(storeName: storeName)
                DispatchQueue.main.async {
                    call.resolve(["entries": entries])
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject(self.nativeFailureMessage("读取原生存储列表失败", error), nil, error)
                }
            }
        }
    }

    @objc public func sizes(_ call: CAPPluginCall) {
        guard let storeName = call.getString("storeName"), isSafeStoreName(storeName) else {
            call.reject("原生存储 store 不正确。")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.recoverInterruptedStoreReplacement(storeName)
                let entries = try self.readEntrySizes(storeName: storeName)
                DispatchQueue.main.async {
                    call.resolve(["entries": entries])
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject(self.nativeFailureMessage("读取原生存储大小列表失败", error), nil, error)
                }
            }
        }
    }

    @objc public func keys(_ call: CAPPluginCall) {
        guard let storeName = call.getString("storeName"), isSafeStoreName(storeName) else {
            call.reject("原生存储 store 不正确。")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.recoverInterruptedStoreReplacement(storeName)
                let keys = try self.readKeys(storeName: storeName)
                DispatchQueue.main.async {
                    call.resolve(["keys": keys])
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject(self.nativeFailureMessage("读取原生存储 key 列表失败", error), nil, error)
                }
            }
        }
    }

    @objc public func keysWithPrefix(_ call: CAPPluginCall) {
        guard let storeName = call.getString("storeName"), isSafeStoreName(storeName) else {
            call.reject("原生存储 store 不正确。")
            return
        }
        guard let keyPrefix = call.getString("keyPrefix") else {
            call.reject("缺少原生存储 key 前缀。")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.recoverInterruptedStoreReplacement(storeName)
                let keys = try self.readKeys(storeName: storeName, prefix: keyPrefix)
                DispatchQueue.main.async {
                    call.resolve(["keys": keys])
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject(self.nativeFailureMessage("读取原生存储 key 前缀列表失败", error), nil, error)
                }
            }
        }
    }

    @objc public func clear(_ call: CAPPluginCall) {
        guard let storeName = call.getString("storeName"), isSafeStoreName(storeName) else {
            call.reject("原生存储 store 不正确。")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.recoverInterruptedStoreReplacement(storeName)
                let url = self.storeDirectory(storeName)
                if FileManager.default.fileExists(atPath: url.path) {
                    try FileManager.default.removeItem(at: url)
                }
                DispatchQueue.main.async {
                    call.resolve()
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject(self.nativeFailureMessage("清空原生存储失败", error), nil, error)
                }
            }
        }
    }

    @objc public func applyKvMutations(_ call: CAPPluginCall) {
        guard let storeName = call.getString("storeName"), isSafeStoreName(storeName) else {
            call.reject("原生存储 store 不正确。")
            return
        }
        guard let mutations = call.getArray("mutations", JSObject.self) else {
            call.reject("原生存储变更格式不正确。")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.recoverInterruptedStoreReplacement(storeName)
                try self.ensureStoreDirectory(storeName)
                for mutation in mutations {
                    guard let type = mutation["type"] as? String, let key = mutation["key"] as? String else {
                        throw NativePersistenceError.invalidPayload
                    }
                    if type == "delete" {
                        try self.removeJsonValue(storeName: storeName, key: key)
                        try self.removeBinaryValue(storeName: storeName, key: key)
                    } else if type == "set" {
                        guard let url = self.primaryJsonUrl(storeName: storeName, key: key) else {
                            throw NativePersistenceError.invalidPayload
                        }
                        let data = try self.jsonData(mutation)
                        try self.removeBinaryValue(storeName: storeName, key: key)
                        try data.write(to: url, options: [.atomic])
                        try self.writeJsonMeta(data, storeName: storeName, key: key)
                    } else {
                        throw NativePersistenceError.invalidPayload
                    }
                }
                DispatchQueue.main.async {
                    call.resolve()
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject(self.nativeFailureMessage("批量写入原生存储失败", error), nil, error)
                }
            }
        }
    }

    @objc public func replaceKv(_ call: CAPPluginCall) {
        guard let storeName = call.getString("storeName"), isSafeStoreName(storeName) else {
            call.reject("原生存储 store 不正确。")
            return
        }
        guard let entries = call.getArray("entries", JSObject.self) else {
            call.reject("原生存储替换格式不正确。")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            var replacementUrl: URL?
            var backupUrl: URL?
            var movedCurrentToBackup = false
            do {
                try self.recoverInterruptedStoreReplacement(storeName)
                let rootUrl = self.rootDirectory()
                try FileManager.default.createDirectory(at: rootUrl, withIntermediateDirectories: true)
                let storeUrl = self.storeDirectory(storeName)
                let replacement = rootUrl.appendingPathComponent("\(storeName).replace-\(UUID().uuidString)", isDirectory: true)
                let backup = rootUrl.appendingPathComponent("\(storeName).backup-\(UUID().uuidString)", isDirectory: true)
                replacementUrl = replacement
                backupUrl = backup
                try FileManager.default.createDirectory(at: replacement, withIntermediateDirectories: true)
                for entry in entries {
                    guard let key = entry["key"] as? String, let url = self.primaryJsonUrl(in: replacement, key: key) else {
                        throw NativePersistenceError.invalidPayload
                    }
                    let data = try self.jsonData(entry)
                    try data.write(to: url, options: [.atomic])
                    try self.writeJsonMeta(data, directory: replacement, key: key)
                }
                if FileManager.default.fileExists(atPath: storeUrl.path) {
                    try FileManager.default.moveItem(at: storeUrl, to: backup)
                    movedCurrentToBackup = true
                }
                try FileManager.default.moveItem(at: replacement, to: storeUrl)
                replacementUrl = nil
                if FileManager.default.fileExists(atPath: backup.path) {
                    try FileManager.default.removeItem(at: backup)
                }
                DispatchQueue.main.async {
                    call.resolve()
                }
            } catch {
                if let replacementUrl, FileManager.default.fileExists(atPath: replacementUrl.path) {
                    try? FileManager.default.removeItem(at: replacementUrl)
                }
                if movedCurrentToBackup,
                   let backupUrl,
                   FileManager.default.fileExists(atPath: backupUrl.path) {
                    let storeUrl = self.storeDirectory(storeName)
                    if FileManager.default.fileExists(atPath: storeUrl.path) {
                        try? FileManager.default.removeItem(at: storeUrl)
                    }
                    try? FileManager.default.moveItem(at: backupUrl, to: storeUrl)
                }
                DispatchQueue.main.async {
                    call.reject(self.nativeFailureMessage("替换原生 KV 存储失败", error), nil, error)
                }
            }
        }
    }

    private struct StoreKeyRequest {
        let storeName: String
        let key: String
    }

    private struct JsonIntegrityMeta: Codable {
        let version: Int
        let byteLength: Int
        let checksum: String
    }

    private struct JsonReadStats {
        let byteLength: Int
        let checksum: String
    }

    private enum NativePersistenceError: LocalizedError {
        case invalidPayload
        case invalidKey
        case invalidPayloadDetail(String)

        var errorDescription: String? {
            switch self {
            case .invalidPayload:
                return "原生存储数据格式不正确。"
            case .invalidKey:
                return "原生存储 key 不正确。"
            case .invalidPayloadDetail(let message):
                return message
            }
        }
    }

    private func nativeFailureMessage(_ prefix: String, _ error: Error) -> String {
        let detail = (error as NSError).localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        if detail.isEmpty {
            return "\(prefix)。"
        }
        return "\(prefix)：\(detail)"
    }

    private func jsonData(_ call: CAPPluginCall) throws -> Data {
        if let jsonText = call.getString("jsonText") {
            return try jsonData(jsonText)
        }
        guard let value = call.options["value"] else {
            throw NativePersistenceError.invalidPayload
        }
        return try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
    }

    private func jsonData(_ object: JSObject) throws -> Data {
        if let jsonText = object["jsonText"] as? String {
            return try jsonData(jsonText)
        }
        guard let value = object["value"] else {
            throw NativePersistenceError.invalidPayload
        }
        return try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
    }

    private func jsonData(_ jsonText: String) throws -> Data {
        guard let data = jsonText.data(using: .utf8) else {
            throw NativePersistenceError.invalidPayload
        }
        return data
    }

    private func jsonText(_ data: Data) throws -> String {
        guard let text = String(data: data, encoding: .utf8) else {
            throw NativePersistenceError.invalidPayload
        }
        return text
    }

    private func validateJsonPayload(_ data: Data) throws {
        _ = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    private func callInt(_ call: CAPPluginCall, _ key: String) -> Int? {
        if let value = call.options[key] as? Int {
            return value
        }
        if let value = call.options[key] as? NSNumber {
            return value.intValue
        }
        return nil
    }

    private func fnv1a32Hex(_ data: Data) -> String {
        var hash: UInt32 = 2166136261
        for byte in data {
            hash ^= UInt32(byte)
            hash = hash &* 16777619
        }
        return String(format: "%08x", hash)
    }

    private func readJsonStats(_ url: URL) throws -> JsonReadStats {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var byteLength = 0
        var hash: UInt32 = 2166136261
        while let data = try handle.read(upToCount: 64 * 1024), !data.isEmpty {
            byteLength += data.count
            for byte in data {
                hash ^= UInt32(byte)
                hash = hash &* 16777619
            }
        }
        return JsonReadStats(
            byteLength: byteLength,
            checksum: String(format: "%08x", hash)
        )
    }

    private func jsonWriteStats(
        actualByteLength: Int,
        actualChecksum: String,
        expectedByteLength: Int?,
        expectedChecksum: String?,
        chunkCount: Int?
    ) -> String {
        var parts = [
            "actualBytes=\(actualByteLength)",
            "actualHash=\(actualChecksum)"
        ]
        if let expectedByteLength {
            parts.insert("expectedBytes=\(expectedByteLength)", at: 0)
        }
        if let expectedChecksum {
            parts.append("expectedHash=\(expectedChecksum)")
        }
        if let chunkCount {
            parts.append("chunks=\(chunkCount)")
        }
        return parts.joined(separator: " ")
    }

    private func readStoreKey(_ call: CAPPluginCall) -> StoreKeyRequest? {
        guard let storeName = call.getString("storeName"), isSafeStoreName(storeName) else {
            call.reject("原生存储 store 不正确。")
            return nil
        }
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("缺少原生存储 key。")
            return nil
        }
        return StoreKeyRequest(storeName: storeName, key: key)
    }

    private func isSafeStoreName(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9._-]+$"#, options: .regularExpression) != nil
    }

    private func isSafeWriteId(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9._-]+$"#, options: .regularExpression) != nil
    }

    private func rootDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("PolarisNativePersistence", isDirectory: true)
    }

    private func storeDirectory(_ storeName: String) -> URL {
        rootDirectory().appendingPathComponent(storeName, isDirectory: true)
    }

    private func recoverInterruptedStoreReplacement(_ storeName: String) throws {
        guard isSafeStoreName(storeName) else {
            throw NativePersistenceError.invalidKey
        }
        let rootUrl = rootDirectory()
        guard FileManager.default.fileExists(atPath: rootUrl.path) else {
            return
        }

        let storeUrl = storeDirectory(storeName)
        let urls = try FileManager.default.contentsOfDirectory(
            at: rootUrl,
            includingPropertiesForKeys: [.isDirectoryKey]
        )
        let backupPrefix = "\(storeName).backup-"
        let replacePrefix = "\(storeName).replace-"
        let backups = urls
            .filter { $0.lastPathComponent.hasPrefix(backupPrefix) && isDirectory($0) }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        let replacements = urls
            .filter { $0.lastPathComponent.hasPrefix(replacePrefix) && isDirectory($0) }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }

        if !FileManager.default.fileExists(atPath: storeUrl.path), let latestBackup = backups.last {
            try FileManager.default.moveItem(at: latestBackup, to: storeUrl)
        }

        for replacement in replacements where FileManager.default.fileExists(atPath: replacement.path) {
            try? FileManager.default.removeItem(at: replacement)
        }
        for backup in backups where FileManager.default.fileExists(atPath: backup.path) {
            try? FileManager.default.removeItem(at: backup)
        }
    }

    private func isDirectory(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
    }

    private func ensureStoreDirectory(_ storeName: String) throws {
        try FileManager.default.createDirectory(at: storeDirectory(storeName), withIntermediateDirectories: true)
    }

    private func legacyEncodedKey(_ key: String) -> String {
        Data(key.utf8)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func decodedKey(_ value: String) -> String? {
        var base64 = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 {
            base64.append("=")
        }
        guard let data = Data(base64Encoded: base64) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func storageStem(_ key: String) -> String {
        let legacy = legacyEncodedKey(key)
        if legacy.count <= maxEncodedKeyStemLength {
            return legacy
        }
        return "h-\(sha256Hex(Data(key.utf8)))"
    }

    private func storageStems(_ key: String) -> [String] {
        let primary = storageStem(key)
        let legacy = legacyEncodedKey(key)
        guard primary != legacy, legacy.count <= maxLegacyFallbackStemLength else {
            return [primary]
        }
        return [primary, legacy]
    }

    private func storageStemNeedsKeyMeta(_ stem: String, key: String) -> Bool {
        stem != legacyEncodedKey(key)
    }

    private func jsonUrl(in directory: URL, stem: String) -> URL {
        directory.appendingPathComponent("\(stem).json")
    }

    private func jsonMetaUrl(in directory: URL, stem: String) -> URL {
        directory.appendingPathComponent("\(stem).json.meta")
    }

    private func binaryUrl(in directory: URL, stem: String) -> URL {
        directory.appendingPathComponent("\(stem).bin")
    }

    private func mimeUrl(in directory: URL, stem: String) -> URL {
        directory.appendingPathComponent("\(stem).mime")
    }

    private func keyMetaUrl(in directory: URL, stem: String) -> URL {
        directory.appendingPathComponent("\(stem).key")
    }

    private func primaryJsonUrl(in directory: URL, key: String) -> URL? {
        guard !key.isEmpty else { return nil }
        return jsonUrl(in: directory, stem: storageStem(key))
    }

    private func primaryJsonUrl(storeName: String, key: String) -> URL? {
        guard isSafeStoreName(storeName) else { return nil }
        return primaryJsonUrl(in: storeDirectory(storeName), key: key)
    }

    private func primaryJsonMetaUrl(in directory: URL, key: String) -> URL? {
        guard !key.isEmpty else { return nil }
        return jsonMetaUrl(in: directory, stem: storageStem(key))
    }

    private func primaryJsonMetaUrl(storeName: String, key: String) -> URL? {
        guard isSafeStoreName(storeName) else { return nil }
        return primaryJsonMetaUrl(in: storeDirectory(storeName), key: key)
    }

    private func primaryBinaryUrl(storeName: String, key: String) -> URL? {
        guard isSafeStoreName(storeName), !key.isEmpty else { return nil }
        return binaryUrl(in: storeDirectory(storeName), stem: storageStem(key))
    }

    private func primaryMimeUrl(storeName: String, key: String) -> URL? {
        guard isSafeStoreName(storeName), !key.isEmpty else { return nil }
        return mimeUrl(in: storeDirectory(storeName), stem: storageStem(key))
    }

    private func existingJsonUrl(storeName: String, key: String) -> URL? {
        guard isSafeStoreName(storeName), !key.isEmpty else { return nil }
        let directory = storeDirectory(storeName)
        for stem in storageStems(key) {
            let url = jsonUrl(in: directory, stem: stem)
            if FileManager.default.fileExists(atPath: url.path) {
                return url
            }
        }
        return nil
    }

    private func existingBinaryUrl(storeName: String, key: String) -> URL? {
        guard isSafeStoreName(storeName), !key.isEmpty else { return nil }
        let directory = storeDirectory(storeName)
        for stem in storageStems(key) {
            let url = binaryUrl(in: directory, stem: stem)
            if FileManager.default.fileExists(atPath: url.path) {
                return url
            }
        }
        return nil
    }

    private func jsonWriteTempUrl(storeName: String, key: String, writeId: String) throws -> URL {
        guard isSafeStoreName(storeName), isSafeWriteId(writeId), !key.isEmpty else {
            throw NativePersistenceError.invalidKey
        }
        return storeDirectory(storeName).appendingPathComponent("\(storageStem(key)).\(writeId).json.tmp")
    }

    private func removeJsonValue(storeName: String, key: String) throws {
        guard isSafeStoreName(storeName), !key.isEmpty else { throw NativePersistenceError.invalidKey }
        let directory = storeDirectory(storeName)
        for stem in storageStems(key) {
            try removeItemIfPresent(jsonUrl(in: directory, stem: stem))
            try removeItemIfPresent(jsonMetaUrl(in: directory, stem: stem))
            try removeItemIfPresent(keyMetaUrl(in: directory, stem: stem))
        }
    }

    private func removeBinaryValue(storeName: String, key: String) throws {
        guard isSafeStoreName(storeName), !key.isEmpty else { throw NativePersistenceError.invalidKey }
        let directory = storeDirectory(storeName)
        for stem in storageStems(key) {
            try removeItemIfPresent(binaryUrl(in: directory, stem: stem))
            try removeItemIfPresent(mimeUrl(in: directory, stem: stem))
            try removeItemIfPresent(keyMetaUrl(in: directory, stem: stem))
        }
    }

    private func removeItemIfPresent(_ url: URL) throws {
        do {
            try FileManager.default.removeItem(at: url)
        } catch CocoaError.fileNoSuchFile {
            return
        } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileNoSuchFileError {
            return
        }
    }

    private func isMissingFileError(_ error: Error) -> Bool {
        if case CocoaError.fileNoSuchFile = error {
            return true
        }
        let nsError = error as NSError
        return nsError.domain == NSCocoaErrorDomain && nsError.code == NSFileNoSuchFileError
    }

    private func writeMimeType(_ mimeType: String, storeName: String, key: String) throws {
        guard let url = primaryMimeUrl(storeName: storeName, key: key) else { throw NativePersistenceError.invalidKey }
        if mimeType.isEmpty {
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
            return
        }
        try mimeType.data(using: .utf8)?.write(to: url, options: [.atomic])
        try writeKeyMetaIfNeeded(storeName: storeName, key: key)
    }

    private func readMimeType(storeName: String, key: String) throws -> String {
        guard isSafeStoreName(storeName), !key.isEmpty else { throw NativePersistenceError.invalidKey }
        let directory = storeDirectory(storeName)
        guard let url = storageStems(key).map({ mimeUrl(in: directory, stem: $0) }).first(where: {
            FileManager.default.fileExists(atPath: $0.path)
        }) else {
            return ""
        }
        return String(data: try Data(contentsOf: url), encoding: .utf8) ?? ""
    }

    private func storageFileUrls(storeName: String) throws -> [URL] {
        let storeUrl = storeDirectory(storeName)
        guard FileManager.default.fileExists(atPath: storeUrl.path) else {
            return []
        }

        return try FileManager.default.contentsOfDirectory(at: storeUrl, includingPropertiesForKeys: nil)
    }

    private func readKeys(storeName: String, prefix: String = "") throws -> [String] {
        let urls = try storageFileUrls(storeName: storeName)
        let directory = storeDirectory(storeName)
        var keys = Set<String>()
        for url in urls {
            let pathExtension = url.pathExtension
            if pathExtension != "json" && pathExtension != "bin" {
                continue
            }
            guard let key = storedKey(for: url.deletingPathExtension().lastPathComponent, in: directory) else {
                continue
            }
            if prefix.isEmpty || key.hasPrefix(prefix) {
                keys.insert(key)
            }
        }
        return Array(keys).sorted()
    }

    private func readEntrySizes(storeName: String) throws -> [[String: Any]] {
        let urls = try storageFileUrls(storeName: storeName)
        let directory = storeDirectory(storeName)
        var entries: [[String: Any]] = []
        var seen = Set<String>()
        for url in urls {
            let pathExtension = url.pathExtension
            if pathExtension != "json" && pathExtension != "bin" {
                continue
            }
            let stem = url.deletingPathExtension().lastPathComponent
            guard seen.insert(stem).inserted,
                  let key = storedKey(for: stem, in: directory) else {
                continue
            }
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            let size = (attributes[.size] as? NSNumber)?.intValue ?? 0
            entries.append([
                "key": key,
                "size": max(0, size)
            ])
        }
        return entries
    }

    private func readEntries(storeName: String) throws -> [[String: Any]] {
        let urls = try storageFileUrls(storeName: storeName)
        let directory = storeDirectory(storeName)
        var entries: [[String: Any]] = []
        for url in urls {
            let pathExtension = url.pathExtension
            if pathExtension != "json" && pathExtension != "bin" {
                continue
            }
            let stem = url.deletingPathExtension().lastPathComponent
            guard let key = storedKey(for: stem, in: directory) else {
                continue
            }
            if pathExtension == "json" {
                do {
                    let data = try Data(contentsOf: url)
                    try verifyJsonMeta(data, storeName: storeName, key: key)
                    let jsonText = try self.jsonText(data)
                    entries.append([
                        "key": key,
                        "kind": "json",
                        "jsonText": jsonText
                    ])
                } catch {
                    if isMissingFileError(error) {
                        continue
                    }
                    throw error
                }
            } else {
                do {
                    let data = try Data(contentsOf: url)
                    var entry: [String: Any] = [
                        "key": key,
                        "kind": "binary",
                        "dataBase64": data.base64EncodedString()
                    ]
                    if let mimeType = try? readMimeType(storeName: storeName, key: key), !mimeType.isEmpty {
                        entry["mimeType"] = mimeType
                    }
                    entries.append(entry)
                } catch {
                    if isMissingFileError(error) {
                        continue
                    }
                    throw error
                }
            }
        }
        return entries
    }

    private func writeJsonMeta(_ data: Data, storeName: String, key: String) throws {
        try writeJsonMeta(data, directory: storeDirectory(storeName), key: key)
    }

    private func writeJsonMeta(_ data: Data, directory: URL, key: String) throws {
        guard let url = primaryJsonMetaUrl(in: directory, key: key) else {
            throw NativePersistenceError.invalidKey
        }
        let meta = JsonIntegrityMeta(
            version: 1,
            byteLength: data.count,
            checksum: fnv1a32Hex(data)
        )
        let metaData = try JSONEncoder().encode(meta)
        try metaData.write(to: url, options: [.atomic])
        try writeKeyMetaIfNeeded(directory: directory, key: key)
    }

    private func repairJsonMetaIfPayloadIsReadable(
        _ data: Data,
        storeName: String,
        key: String,
        reason: String
    ) throws {
        do {
            try validateJsonPayload(data)
            try writeJsonMeta(data, storeName: storeName, key: key)
        } catch {
            throw NativePersistenceError.invalidPayloadDetail(reason)
        }
    }

    private func verifyJsonMeta(_ data: Data, storeName: String, key: String) throws {
        guard isSafeStoreName(storeName), !key.isEmpty else { throw NativePersistenceError.invalidKey }
        let directory = storeDirectory(storeName)
        guard let url = storageStems(key).map({ jsonMetaUrl(in: directory, stem: $0) }).first(where: {
            FileManager.default.fileExists(atPath: $0.path)
        }) else {
            return
        }
        let meta: JsonIntegrityMeta
        do {
            meta = try JSONDecoder().decode(JsonIntegrityMeta.self, from: try Data(contentsOf: url))
        } catch {
            try repairJsonMetaIfPayloadIsReadable(
                data,
                storeName: storeName,
                key: key,
                reason: "原生 JSON 校验信息不可读。"
            )
            return
        }
        let actualChecksum = fnv1a32Hex(data)
        if meta.byteLength != data.count {
            try repairJsonMetaIfPayloadIsReadable(
                data,
                storeName: storeName,
                key: key,
                reason: "原生 JSON 读取字节数不一致（expectedBytes=\(meta.byteLength) actualBytes=\(data.count)）。"
            )
            return
        }
        if meta.checksum != actualChecksum {
            try repairJsonMetaIfPayloadIsReadable(
                data,
                storeName: storeName,
                key: key,
                reason: "原生 JSON 读取校验值不一致（expectedHash=\(meta.checksum) actualHash=\(actualChecksum)）。"
            )
        }
    }

    private func verifyJsonMetaStats(
        _ stats: JsonReadStats,
        payloadUrl: URL,
        storeName: String,
        key: String
    ) throws {
        guard isSafeStoreName(storeName), !key.isEmpty else { throw NativePersistenceError.invalidKey }
        let directory = storeDirectory(storeName)
        guard let url = storageStems(key).map({ jsonMetaUrl(in: directory, stem: $0) }).first(where: {
            FileManager.default.fileExists(atPath: $0.path)
        }) else {
            return
        }

        let meta: JsonIntegrityMeta
        do {
            meta = try JSONDecoder().decode(JsonIntegrityMeta.self, from: try Data(contentsOf: url))
        } catch {
            let data = try Data(contentsOf: payloadUrl)
            try verifyJsonMeta(data, storeName: storeName, key: key)
            return
        }

        if meta.byteLength != stats.byteLength || meta.checksum != stats.checksum {
            let data = try Data(contentsOf: payloadUrl)
            try verifyJsonMeta(data, storeName: storeName, key: key)
        }
    }

    private func writeKeyMetaIfNeeded(storeName: String, key: String) throws {
        try writeKeyMetaIfNeeded(directory: storeDirectory(storeName), key: key)
    }

    private func writeKeyMetaIfNeeded(directory: URL, key: String) throws {
        let stem = storageStem(key)
        guard storageStemNeedsKeyMeta(stem, key: key) else { return }
        guard let data = key.data(using: .utf8) else { throw NativePersistenceError.invalidKey }
        try data.write(to: keyMetaUrl(in: directory, stem: stem), options: [.atomic])
    }

    private func storedKey(for stem: String, in directory: URL) -> String? {
        if stem.hasPrefix("h-") {
            let url = keyMetaUrl(in: directory, stem: stem)
            guard FileManager.default.fileExists(atPath: url.path),
                  let key = try? String(data: Data(contentsOf: url), encoding: .utf8),
                  !key.isEmpty else {
                return nil
            }
            return key
        }
        return decodedKey(stem)
    }
}
