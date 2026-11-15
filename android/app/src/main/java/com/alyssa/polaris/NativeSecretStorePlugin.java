package com.alyssa.polaris;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "NativeSecretStore")
public class NativeSecretStorePlugin extends Plugin {
    private static final String KEY_ALIAS = "polaris.mcp.oauth.credentials";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String PREFERENCES = "polaris_mcp_oauth_credentials";
    private static final int GCM_TAG_BITS = 128;

    @PluginMethod
    public void get(PluginCall call) {
        try {
            String key = requireKey(call);
            String encoded = preferences().getString(key, null);
            JSObject result = new JSObject();
            if (encoded != null) result.put("value", decrypt(encoded));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法读取 MCP OAuth 凭据。", error);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        try {
            String key = requireKey(call);
            String value = call.getString("value");
            if (value == null) throw new IllegalArgumentException("缺少凭据值。");
            preferences().edit().putString(key, encrypt(value)).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("无法保存 MCP OAuth 凭据。", error);
        }
    }

    @PluginMethod
    public void delete(PluginCall call) {
        try {
            preferences().edit().remove(requireKey(call)).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("无法删除 MCP OAuth 凭据。", error);
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private String requireKey(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty() || key.length() > 240) {
            throw new IllegalArgumentException("MCP OAuth 凭据键不正确。");
        }
        return key;
    }

    private SecretKey encryptionKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
         .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
         .build());
        return generator.generateKey();
    }

    private String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        byte[] combined = new byte[1 + iv.length + encrypted.length];
        combined[0] = (byte) iv.length;
        System.arraycopy(iv, 0, combined, 1, iv.length);
        System.arraycopy(encrypted, 0, combined, 1 + iv.length, encrypted.length);
        return Base64.encodeToString(combined, Base64.NO_WRAP);
    }

    private String decrypt(String encoded) throws Exception {
        byte[] combined = Base64.decode(encoded, Base64.NO_WRAP);
        int ivLength = combined[0] & 0xff;
        if (ivLength < 12 || combined.length <= 1 + ivLength) {
            throw new IllegalArgumentException("凭据密文不正确。");
        }
        byte[] iv = new byte[ivLength];
        byte[] encrypted = new byte[combined.length - 1 - ivLength];
        System.arraycopy(combined, 1, iv, 0, ivLength);
        System.arraycopy(combined, 1 + ivLength, encrypted, 0, encrypted.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }
}
