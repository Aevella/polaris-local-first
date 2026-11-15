package com.alyssa.polaris;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Iterator;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "NativeMcpSse")
public class NativeMcpSsePlugin extends Plugin {
    private final Map<String, SseConnection> connections = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final ScheduledExecutorService timeouts = Executors.newSingleThreadScheduledExecutor();

    @PluginMethod
    public void open(PluginCall call) {
        String connectionId = call.getString("connectionId");
        String url = call.getString("url");
        Integer timeoutValue = call.getInt("timeoutMs");
        if (connectionId == null || connectionId.isEmpty() || url == null || url.isEmpty()) {
            call.reject("MCP SSE 连接参数不完整。");
            return;
        }
        try {
            URL endpoint = new URL(url);
            String protocol = endpoint.getProtocol();
            if (!"http".equalsIgnoreCase(protocol) && !"https".equalsIgnoreCase(protocol)) {
                call.reject("MCP SSE 地址不正确。");
                return;
            }
            int timeoutMs = Math.max(1, timeoutValue == null ? 30_000 : timeoutValue);
            SseConnection connection = new SseConnection(
                connectionId,
                endpoint,
                call.getObject("headers"),
                timeoutMs,
                call
            );
            SseConnection previous = connections.put(connectionId, connection);
            if (previous != null) previous.close();
            executor.execute(connection);
        } catch (IOException error) {
            call.reject("MCP SSE 地址不正确。", error);
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        String connectionId = call.getString("connectionId");
        if (connectionId == null || connectionId.isEmpty()) {
            call.reject("缺少 MCP SSE 连接标识。");
            return;
        }
        SseConnection connection = connections.remove(connectionId);
        if (connection != null) connection.close();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (SseConnection connection : connections.values()) connection.close();
        connections.clear();
        executor.shutdownNow();
        timeouts.shutdownNow();
    }

    private final class SseConnection implements Runnable {
        private final String connectionId;
        private final URL url;
        private final JSObject headers;
        private final int timeoutMs;
        private final PluginCall openCall;
        private volatile boolean closed = false;
        private volatile boolean endpointResolved = false;
        private volatile HttpURLConnection connection;
        private volatile ScheduledFuture<?> endpointTimeout;

        SseConnection(String connectionId, URL url, JSObject headers, int timeoutMs, PluginCall openCall) {
            this.connectionId = connectionId;
            this.url = url;
            this.headers = headers == null ? new JSObject() : headers;
            this.timeoutMs = timeoutMs;
            this.openCall = openCall;
        }

        @Override
        public void run() {
            try {
                HttpURLConnection http = (HttpURLConnection) url.openConnection();
                connection = http;
                http.setRequestMethod("GET");
                http.setConnectTimeout(timeoutMs);
                // The persistent event channel can be idle between tool calls.
                // Endpoint admission and each RPC have separate deadlines.
                http.setReadTimeout(0);
                endpointTimeout = timeouts.schedule(() -> {
                    if (!closed && !endpointResolved) {
                        fail("等待 MCP SSE 服务下发 endpoint 超时（" + (int) Math.ceil(timeoutMs / 1000.0) + " 秒）。");
                        http.disconnect();
                    }
                }, timeoutMs, TimeUnit.MILLISECONDS);
                http.setRequestProperty("Accept", "text/event-stream");
                Iterator<String> headerKeys = headers.keys();
                while (headerKeys.hasNext()) {
                    String key = headerKeys.next();
                    String value = headers.getString(key);
                    if (value != null) http.setRequestProperty(key, value);
                }

                int status = http.getResponseCode();
                if (status < 200 || status >= 300) {
                    throw new IOException("连接 MCP SSE 服务失败：HTTP " + status);
                }
                try (InputStream stream = http.getInputStream();
                     BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                    String eventName = "message";
                    StringBuilder data = new StringBuilder();
                    String line;
                    while (!closed && (line = reader.readLine()) != null) {
                        if (line.isEmpty()) {
                            dispatch(eventName, data.toString());
                            eventName = "message";
                            data.setLength(0);
                            continue;
                        }
                        if (line.startsWith(":")) continue;
                        if (line.startsWith("event:")) {
                            eventName = line.substring(6).trim();
                            if (eventName.isEmpty()) eventName = "message";
                        } else if (line.startsWith("data:")) {
                            if (data.length() > 0) data.append('\n');
                            data.append(line.substring(5).trim());
                        }
                    }
                }
                if (!closed) {
                    fail("MCP SSE 连接已结束。");
                }
            } catch (Exception error) {
                if (!closed) fail(error.getMessage() == null ? "MCP SSE 连接中断。" : error.getMessage());
            } finally {
                cancelEndpointTimeout();
                connections.remove(connectionId, this);
                HttpURLConnection http = connection;
                if (http != null) http.disconnect();
            }
        }

        synchronized void close() {
            closed = true;
            cancelEndpointTimeout();
            HttpURLConnection http = connection;
            if (http != null) http.disconnect();
        }

        private synchronized void dispatch(String eventName, String data) throws IOException {
            if (closed) return;
            if (data.isEmpty()) return;
            if ("endpoint".equals(eventName) && !endpointResolved) {
                endpointResolved = true;
                cancelEndpointTimeout();
                JSObject result = new JSObject();
                result.put("endpoint", new URL(url, data).toString());
                openCall.resolve(result);
                return;
            }
            JSObject event = new JSObject();
            event.put("connectionId", connectionId);
            event.put("event", eventName);
            event.put("data", data);
            notifyListeners("event", event);
        }

        private synchronized void fail(String message) {
            if (closed) return;
            closed = true;
            cancelEndpointTimeout();
            if (!endpointResolved) {
                openCall.reject(message);
                return;
            }
            JSObject error = new JSObject();
            error.put("connectionId", connectionId);
            error.put("message", message);
            notifyListeners("error", error);
        }

        private void cancelEndpointTimeout() {
            ScheduledFuture<?> timeout = endpointTimeout;
            if (timeout != null) timeout.cancel(false);
        }
    }
}
