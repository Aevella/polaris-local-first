import Capacitor
import Foundation
import Security

@objc(NativeSecretStorePlugin)
public class NativeSecretStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeSecretStorePlugin"
    public let jsName = "NativeSecretStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "delete", returnType: CAPPluginReturnPromise)
    ]

    private let service = "com.alyssa.polaris.mcp-oauth"

    @objc public func get(_ call: CAPPluginCall) {
        guard let key = validKey(call) else { return }
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            call.resolve([:])
            return
        }
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            call.reject("无法读取 MCP OAuth 凭据（Keychain \(status)）。")
            return
        }
        call.resolve(["value": value])
    }

    @objc public func set(_ call: CAPPluginCall) {
        guard let key = validKey(call), let value = call.getString("value") else {
            if call.getString("value") == nil { call.reject("缺少凭据值。") }
            return
        }
        let data = Data(value.utf8)
        let query = baseQuery(key)
        let updateStatus = SecItemUpdate(
            query as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if updateStatus == errSecSuccess {
            call.resolve()
            return
        }
        guard updateStatus == errSecItemNotFound else {
            call.reject("无法更新 MCP OAuth 凭据（Keychain \(updateStatus)）。")
            return
        }
        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let insertStatus = SecItemAdd(insert as CFDictionary, nil)
        guard insertStatus == errSecSuccess else {
            call.reject("无法保存 MCP OAuth 凭据（Keychain \(insertStatus)）。")
            return
        }
        call.resolve()
    }

    @objc public func delete(_ call: CAPPluginCall) {
        guard let key = validKey(call) else { return }
        let status = SecItemDelete(baseQuery(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("无法删除 MCP OAuth 凭据（Keychain \(status)）。")
            return
        }
        call.resolve()
    }

    private func validKey(_ call: CAPPluginCall) -> String? {
        guard let key = call.getString("key"), !key.isEmpty, key.count <= 240 else {
            call.reject("MCP OAuth 凭据键不正确。")
            return nil
        }
        return key
    }

    private func baseQuery(_ key: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
    }
}
