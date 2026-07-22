package com.alyssa.polaris;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NativeProviderHttp")
public class NativeProviderHttpPlugin extends Plugin {
    private final Map<String, ProviderRequest> requests = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newCachedThreadPool();

    @PluginMethod
    public void start(PluginCall call) {
        String requestId = call.getString("requestId");
        String urlText = call.getString("url");
        String body = call.getString("body");
        if (requestId == null || requestId.isEmpty() || urlText == null || urlText.isEmpty() || body == null) {
            call.reject("模型请求参数不完整。");
            return;
        }

        try {
            URL url = new URL(urlText);
            String protocol = url.getProtocol();
            if (!"http".equalsIgnoreCase(protocol) && !"https".equalsIgnoreCase(protocol)) {
                call.reject("模型请求地址不正确。");
                return;
            }
            ProviderRequest request = new ProviderRequest(requestId, url, call.getObject("headers"), body, call);
            ProviderRequest previous = requests.put(requestId, request);
            if (previous != null) previous.cancel();
            executor.execute(request);
        } catch (Exception error) {
            call.reject("模型请求地址不正确。", error);
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String requestId = call.getString("requestId");
        if (requestId == null || requestId.isEmpty()) {
            call.reject("缺少模型请求标识。");
            return;
        }
        ProviderRequest request = requests.remove(requestId);
        if (request != null) request.cancel();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (ProviderRequest request : requests.values()) request.cancel();
        requests.clear();
        executor.shutdownNow();
    }

    private final class ProviderRequest implements Runnable {
        private final String requestId;
        private final URL url;
        private final JSObject headers;
        private final String body;
        private final PluginCall startCall;
        private volatile boolean cancelled = false;
        private volatile boolean responseResolved = false;
        private volatile HttpURLConnection connection;

        ProviderRequest(String requestId, URL url, JSObject headers, String body, PluginCall startCall) {
            this.requestId = requestId;
            this.url = url;
            this.headers = headers == null ? new JSObject() : headers;
            this.body = body;
            this.startCall = startCall;
        }

        @Override
        public void run() {
            try {
                HttpURLConnection http = (HttpURLConnection) url.openConnection();
                connection = http;
                http.setRequestMethod("POST");
                http.setDoOutput(true);
                http.setConnectTimeout(0);
                http.setReadTimeout(0);
                byte[] requestBody = body.getBytes(StandardCharsets.UTF_8);
                http.setFixedLengthStreamingMode(requestBody.length);
                Iterator<String> headerKeys = headers.keys();
                while (headerKeys.hasNext()) {
                    String key = headerKeys.next();
                    String value = headers.getString(key);
                    if (value != null) http.setRequestProperty(key, value);
                }

                try (OutputStream output = http.getOutputStream()) {
                    output.write(requestBody);
                }

                int status = http.getResponseCode();
                responseResolved = true;
                JSObject response = new JSObject();
                response.put("status", status);
                response.put("contentType", http.getContentType() == null ? "" : http.getContentType());
                startCall.resolve(response);

                InputStream source = status >= 400 ? http.getErrorStream() : http.getInputStream();
                if (source != null) {
                    try (InputStream stream = source) {
                        byte[] buffer = new byte[16 * 1024];
                        int count;
                        while (!cancelled && (count = stream.read(buffer)) != -1) {
                            if (count == 0) continue;
                            JSObject event = baseEvent("chunk");
                            event.put("data", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP));
                            notifyListeners("event", event);
                        }
                    }
                }
                if (!cancelled) notifyListeners("event", baseEvent("complete"));
            } catch (Exception error) {
                if (!cancelled) fail(error.getMessage() == null ? "原生模型网络请求失败。" : error.getMessage());
            } finally {
                requests.remove(requestId, this);
                HttpURLConnection http = connection;
                if (http != null) http.disconnect();
            }
        }

        void cancel() {
            cancelled = true;
            HttpURLConnection http = connection;
            if (http != null) http.disconnect();
        }

        private JSObject baseEvent(String type) {
            JSObject event = new JSObject();
            event.put("requestId", requestId);
            event.put("type", type);
            return event;
        }

        private void fail(String message) {
            if (!responseResolved) {
                startCall.reject("原生模型网络请求失败：" + message);
                return;
            }
            JSObject event = baseEvent("error");
            event.put("message", "原生模型网络请求失败：" + message);
            notifyListeners("event", event);
        }
    }
}
