package com.alyssa.polaris;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import okhttp3.Credentials;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

final class WebDavHttpTransport {
    static final class Result {
        final int statusCode;
        final String mimeType;
        final String body;
        final long byteLength;

        Result(int statusCode, String mimeType, String body, long byteLength) {
            this.statusCode = statusCode;
            this.mimeType = mimeType;
            this.body = body;
            this.byteLength = byteLength;
        }
    }

    private final OkHttpClient client;

    WebDavHttpTransport(OkHttpClient client) {
        this.client = client;
    }

    Result listDirectory(String url, String username, String password) throws IOException {
        Request request = requestBuilder(url, username, password)
            .method("PROPFIND", null)
            .header("Depth", "1")
            .header("Accept", "application/xml, text/xml;q=0.9, */*;q=0.8")
            .header("Content-Type", "application/xml; charset=utf-8")
            .build();
        try (Response response = client.newCall(request).execute()) {
            ResponseBody body = response.body();
            return new Result(
                response.code(),
                response.header("Content-Type", ""),
                body == null ? "" : body.string(),
                0
            );
        }
    }

    Result downloadFile(String url, String username, String password, File target) throws IOException {
        Request request = requestBuilder(url, username, password).get().build();
        try (Response response = client.newCall(request).execute()) {
            ResponseBody body = response.body();
            String mimeType = response.header("Content-Type", "");
            if (response.code() != 200 || body == null) {
                return new Result(
                    response.code(),
                    mimeType,
                    body == null ? "" : body.string(),
                    0
                );
            }
            try (InputStream input = body.byteStream(); FileOutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[256 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (count > 0) output.write(buffer, 0, count);
                }
            }
            return new Result(response.code(), mimeType, "", target.length());
        }
    }

    Result uploadFile(
        String url,
        String username,
        String password,
        String mimeType,
        File source
    ) throws IOException {
        MediaType mediaType = MediaType.parse(mimeType == null || mimeType.isEmpty()
            ? "application/zip"
            : mimeType);
        RequestBody body = RequestBody.create(mediaType, source);
        Request request = requestBuilder(url, username, password).put(body).build();
        try (Response response = client.newCall(request).execute()) {
            ResponseBody responseBody = response.body();
            return new Result(
                response.code(),
                response.header("Content-Type", ""),
                responseBody == null ? "" : responseBody.string(),
                0
            );
        }
    }

    private Request.Builder requestBuilder(String url, String username, String password) {
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            throw new IllegalArgumentException("WebDAV 地址不正确。");
        }
        return new Request.Builder()
            .url(url)
            .header("Authorization", Credentials.basic(
                username == null ? "" : username,
                password == null ? "" : password,
                StandardCharsets.UTF_8
            ));
    }
}
