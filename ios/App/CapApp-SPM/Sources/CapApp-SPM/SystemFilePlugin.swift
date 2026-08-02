import Capacitor
import Foundation
import UIKit
import UniformTypeIdentifiers

@objc(SystemFilePlugin)
public class SystemFilePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "SystemFilePlugin"
    public let jsName = "SystemFile"
    private static let importCopyBufferBytes = 1024 * 1024
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "importBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginExportBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendExportBackupChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishExportBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelExportBackup", returnType: CAPPluginReturnPromise)
    ]

    private enum PendingOperation {
        case importing(CAPPluginCall)
        case importingFiles(CAPPluginCall)
        case exporting(CAPPluginCall, URL)
    }

    private var pendingOperation: PendingOperation?
    private var stagedExports: [String: URL] = [:]

    @objc public func importBackup(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pendingOperation == nil else {
                call.reject("已有文件操作正在进行。")
                return
            }
            guard let presenter = self.bridge?.viewController else {
                call.reject("当前无法打开系统文件。")
                return
            }

            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.zip, UTType.json], asCopy: true)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.pendingOperation = .importing(call)
            presenter.present(picker, animated: true)
        }
    }

    @objc public func importFiles(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pendingOperation == nil else {
                call.reject("已有文件操作正在进行。")
                return
            }
            guard let presenter = self.bridge?.viewController else {
                call.reject("当前无法打开系统文件。")
                return
            }

            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: self.resolveContentTypes(accept: call.getString("accept")),
                asCopy: true
            )
            picker.delegate = self
            picker.allowsMultipleSelection = call.getBool("multiple") ?? false
            self.pendingOperation = .importingFiles(call)
            presenter.present(picker, animated: true)
        }
    }

    @objc public func exportBackup(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pendingOperation == nil else {
                call.reject("已有文件操作正在进行。")
                return
            }
            guard let presenter = self.bridge?.viewController else {
                call.reject("当前无法打开系统文件。")
                return
            }
            guard let fileName = call.getString("fileName"), !fileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                call.reject("缺少导出文件名。")
                return
            }
            guard let dataBase64 = call.getString("dataBase64"), let data = Data(base64Encoded: dataBase64) else {
                call.reject("导出内容格式不正确。")
                return
            }

            let tempUrl = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
            do {
                if FileManager.default.fileExists(atPath: tempUrl.path) {
                    try FileManager.default.removeItem(at: tempUrl)
                }
                try data.write(to: tempUrl, options: [.atomic])
            } catch {
                call.reject("写入临时导出文件失败。", nil, error)
                return
            }

            let picker = UIDocumentPickerViewController(forExporting: [tempUrl], asCopy: true)
            picker.delegate = self
            self.pendingOperation = .exporting(call, tempUrl)
            presenter.present(picker, animated: true)
        }
    }

    @objc public func beginExportBackup(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let fileName = call.getString("fileName"), !fileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                call.reject("缺少导出文件名。")
                return
            }

            let exportId = UUID().uuidString
            let tempUrl = FileManager.default.temporaryDirectory
                .appendingPathComponent("polaris-export-\(exportId)-\(fileName)")

            do {
                if FileManager.default.fileExists(atPath: tempUrl.path) {
                    try FileManager.default.removeItem(at: tempUrl)
                }
                FileManager.default.createFile(atPath: tempUrl.path, contents: nil)
                self.stagedExports[exportId] = tempUrl
                call.resolve([
                    "exportId": exportId
                ])
            } catch {
                call.reject("创建临时导出文件失败。", nil, error)
            }
        }
    }

    @objc public func appendExportBackupChunk(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let exportId = call.getString("exportId"), let tempUrl = self.stagedExports[exportId] else {
                call.reject("导出会话不存在。")
                return
            }
            guard let dataBase64 = call.getString("dataBase64"), let data = Data(base64Encoded: dataBase64) else {
                call.reject("导出分块格式不正确。")
                return
            }

            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let handle = try FileHandle(forWritingTo: tempUrl)
                    try handle.seekToEnd()
                    try handle.write(contentsOf: data)
                    try handle.close()
                    call.resolve()
                } catch {
                    call.reject("写入导出分块失败。", nil, error)
                }
            }
        }
    }

    @objc public func finishExportBackup(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pendingOperation == nil else {
                call.reject("已有文件操作正在进行。")
                return
            }
            guard let presenter = self.bridge?.viewController else {
                call.reject("当前无法打开系统文件。")
                return
            }
            guard let exportId = call.getString("exportId"), let tempUrl = self.stagedExports.removeValue(forKey: exportId) else {
                call.reject("导出会话不存在。")
                return
            }

            let picker = UIDocumentPickerViewController(forExporting: [tempUrl], asCopy: true)
            picker.delegate = self
            self.pendingOperation = .exporting(call, tempUrl)
            presenter.present(picker, animated: true)
        }
    }

    @objc public func cancelExportBackup(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let exportId = call.getString("exportId") else {
                call.resolve()
                return
            }
            if let tempUrl = self.stagedExports.removeValue(forKey: exportId) {
                self.cleanupTemporaryFile(tempUrl)
            }
            call.resolve()
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        switch pendingOperation {
        case .importing(let call):
            pendingOperation = nil
            call.resolve([
                "canceled": true
            ])
        case .importingFiles(let call):
            pendingOperation = nil
            call.resolve([
                "canceled": true
            ])
        case .exporting(let call, let tempUrl):
            cleanupTemporaryFile(tempUrl)
            pendingOperation = nil
            call.resolve([
                "canceled": true
            ])
        case .none:
            break
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let firstUrl = urls.first else {
            documentPickerWasCancelled(controller)
            return
        }

        switch pendingOperation {
        case .importing(let call):
            pendingOperation = nil
            resolveImport(call: call, url: firstUrl)
        case .importingFiles(let call):
            pendingOperation = nil
            resolveImports(call: call, urls: urls)
        case .exporting(let call, let tempUrl):
            cleanupTemporaryFile(tempUrl)
            pendingOperation = nil
            call.resolve([
                "canceled": false
            ])
        case .none:
            break
        }
    }

    private func resolveImport(call: CAPPluginCall, url: URL) {
        let startedAccessing = url.startAccessingSecurityScopedResource()
        defer {
            if startedAccessing {
                url.stopAccessingSecurityScopedResource()
            }
        }

        do {
            let importUrl = try copyImportFileToTemporaryDirectory(url)
            let mimeType = UTType(filenameExtension: importUrl.pathExtension)?.preferredMIMEType ?? "application/zip"
            let size = (try? FileManager.default.attributesOfItem(atPath: importUrl.path)[.size] as? NSNumber)?.intValue ?? 0
            call.resolve([
                "canceled": false,
                "name": url.lastPathComponent,
                "mimeType": mimeType,
                "fileUrl": importUrl.absoluteString,
                "size": size
            ])
        } catch {
            call.reject("读取导入文件失败。", nil, error)
        }
    }

    private func resolveImports(call: CAPPluginCall, urls: [URL]) {
        do {
            let files = try urls.map { url in
                try importFilePayload(url: url)
            }
            call.resolve([
                "canceled": false,
                "files": files
            ])
        } catch {
            call.reject("读取导入文件失败。", nil, error)
        }
    }

    private func importFilePayload(url: URL) throws -> [String: Any] {
        let startedAccessing = url.startAccessingSecurityScopedResource()
        defer {
            if startedAccessing {
                url.stopAccessingSecurityScopedResource()
            }
        }

        let importUrl = try copyImportFileToTemporaryDirectory(url)
        let mimeType = UTType(filenameExtension: importUrl.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let size = (try? FileManager.default.attributesOfItem(atPath: importUrl.path)[.size] as? NSNumber)?.intValue ?? 0
        return [
            "name": url.lastPathComponent,
            "mimeType": mimeType,
            "fileUrl": importUrl.absoluteString,
            "size": size
        ]
    }

    private func resolveContentTypes(accept: String?) -> [UTType] {
        let rawTokens = (accept ?? "")
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let types = rawTokens.compactMap { token -> UTType? in
            if token == "*/*" {
                return .item
            }
            if token.hasSuffix("/*") {
                switch token.dropLast(2) {
                case "image":
                    return .image
                case "text":
                    return .text
                case "audio":
                    return .audio
                case "video":
                    return .movie
                default:
                    return nil
                }
            }
            if token.hasPrefix(".") {
                return UTType(filenameExtension: String(token.dropFirst()))
            }
            return UTType(mimeType: token)
        }
        return types.isEmpty ? [.item] : types
    }

    private func fileByteLength(_ url: URL) throws -> Int {
        let value = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber
        return value?.intValue ?? 0
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

    private func removeItemIfPresent(_ url: URL) throws {
        do {
            try FileManager.default.removeItem(at: url)
        } catch CocoaError.fileNoSuchFile {
            return
        } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileNoSuchFileError {
            return
        }
    }

    private func copyImportFileToTemporaryDirectory(_ url: URL) throws -> URL {
        let originalName = url.lastPathComponent.isEmpty ? "polaris-backup.zip" : url.lastPathComponent
        let safeName = originalName.replacingOccurrences(
            of: #"[^A-Za-z0-9._-]"#,
            with: "-",
            options: .regularExpression
        )
        let targetUrl = FileManager.default.temporaryDirectory
            .appendingPathComponent("polaris-import-\(UUID().uuidString)-\(safeName)")

        if FileManager.default.fileExists(atPath: targetUrl.path) {
            try FileManager.default.removeItem(at: targetUrl)
        }
        try copyExternalImportFile(from: url, to: targetUrl)
        return targetUrl
    }

    private func copyExternalImportFile(from sourceUrl: URL, to targetUrl: URL) throws {
        var coordinationError: NSError?
        var copyError: Error?
        let coordinator = NSFileCoordinator(filePresenter: nil)

        coordinator.coordinate(readingItemAt: sourceUrl, options: [], error: &coordinationError) { coordinatedUrl in
            do {
                try copyImportFileContents(from: coordinatedUrl, to: targetUrl)
            } catch {
                copyError = error
            }
        }

        if let copyError {
            throw copyError
        }
        if let coordinationError {
            try copyImportFileContents(from: sourceUrl, to: targetUrl)
        }
    }

    private func copyImportFileContents(from sourceUrl: URL, to targetUrl: URL) throws {
        do {
            try removeItemIfPresent(targetUrl)
            try FileManager.default.copyItem(at: sourceUrl, to: targetUrl)
        } catch {
            try removeItemIfPresent(targetUrl)
            try streamCopyImportFile(from: sourceUrl, to: targetUrl)
        }
    }

    private func streamCopyImportFile(from sourceUrl: URL, to targetUrl: URL) throws {
        guard let input = InputStream(url: sourceUrl) else {
            throw NSError(
                domain: "SystemFilePlugin",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "无法打开导入文件。"]
            )
        }
        guard let output = OutputStream(url: targetUrl, append: false) else {
            throw NSError(
                domain: "SystemFilePlugin",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "无法创建导入临时文件。"]
            )
        }

        input.open()
        output.open()
        defer {
            input.close()
            output.close()
        }

        var buffer = [UInt8](repeating: 0, count: Self.importCopyBufferBytes)
        while true {
            let bytesRead = input.read(&buffer, maxLength: buffer.count)
            if bytesRead == 0 {
                break
            }
            if bytesRead < 0 {
                throw input.streamError ?? NSError(
                    domain: "SystemFilePlugin",
                    code: 4,
                    userInfo: [NSLocalizedDescriptionKey: "读取导入文件失败。"]
                )
            }

            var bytesWritten = 0
            while bytesWritten < bytesRead {
                let written = buffer.withUnsafeBytes { rawBuffer -> Int in
                    guard let baseAddress = rawBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else {
                        return 0
                    }
                    return output.write(
                        baseAddress.advanced(by: bytesWritten),
                        maxLength: bytesRead - bytesWritten
                    )
                }
                if written <= 0 {
                    throw output.streamError ?? NSError(
                        domain: "SystemFilePlugin",
                        code: 5,
                        userInfo: [NSLocalizedDescriptionKey: "写入导入临时文件失败。"]
                    )
                }
                bytesWritten += written
            }
        }
    }

    private func cleanupTemporaryFile(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }
}
