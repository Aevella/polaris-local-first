package com.alyssa.polaris;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;

@CapacitorPlugin(name = "WebDav")
public class WebDavPlugin extends Plugin {
    private static final String DOWNLOAD_PREFIX = "polaris-webdav-download-";
    private static final String UPLOAD_PREFIX = "polaris-webdav-upload-";
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, File> downloads = new ConcurrentHashMap<>();
    private final Map<String, StagedUpload> uploads = new ConcurrentHashMap<>();
    private final WebDavHttpTransport transport = new WebDavHttpTransport(
        new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .writeTimeout(0, TimeUnit.MILLISECONDS)
            .callTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    );

    private static final class StagedUpload {
        final File file;
        final String url;
        final String username;
        final String password;
        final String mimeType;

        StagedUpload(File file, String url, String username, String password, String mimeType) {
            this.file = file;
            this.url = url;
            this.username = username;
            this.password = password;
            this.mimeType = mimeType;
        }
    }

    @PluginMethod
    public void listDirectory(PluginCall call) {
        String url = required(call, "url");
        if (url == null) return;
        executor.execute(() -> {
            try {
                WebDavHttpTransport.Result result = transport.listDirectory(
                    url,
                    call.getString("username", ""),
                    call.getString("password", "")
                );
                JSObject payload = resultPayload(result);
                payload.put("body", result.body);
                call.resolve(payload);
            } catch (Exception error) {
                rejectNetwork(call, "读取 WebDAV 目录失败", error);
            }
        });
    }

    @PluginMethod
    public void downloadFile(PluginCall call) {
        String url = required(call, "url");
        if (url == null) return;
        executor.execute(() -> {
            File target = null;
            try {
                target = temporaryFile(DOWNLOAD_PREFIX);
                WebDavHttpTransport.Result result = transport.downloadFile(
                    url,
                    call.getString("username", ""),
                    call.getString("password", ""),
                    target
                );
                JSObject payload = resultPayload(result);
                if (result.statusCode == 200) {
                    String downloadId = UUID.randomUUID().toString();
                    downloads.put(downloadId, target);
                    payload.put("downloadId", downloadId);
                    payload.put("size", result.byteLength);
                    target = null;
                } else {
                    payload.put("body", result.body);
                }
                call.resolve(payload);
            } catch (Exception error) {
                rejectNetwork(call, "下载 WebDAV 备份失败", error);
            } finally {
                delete(target);
            }
        });
    }

    @PluginMethod
    public void readDownloadFileChunk(PluginCall call) {
        String downloadId = call.getString("downloadId");
        File file = downloadId == null ? null : downloads.get(downloadId);
        if (file == null) {
            call.reject("WebDAV 下载文件会话不存在。");
            return;
        }
        long offset = PluginCallNumbers.readLong(call.getData(), "offset");
        long length = PluginCallNumbers.readLong(call.getData(), "length");
        if (offset < 0 || length < 0 || length > Integer.MAX_VALUE || offset > file.length()) {
            call.reject("WebDAV 下载文件分块范围无效。");
            return;
        }
        executor.execute(() -> {
            int readable = (int) Math.min(length, file.length() - offset);
            byte[] bytes = new byte[readable];
            try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
                input.seek(offset);
                int total = 0;
                while (total < readable) {
                    int count = input.read(bytes, total, readable - total);
                    if (count < 0) break;
                    total += count;
                }
                JSObject payload = new JSObject();
                payload.put("dataBase64", Base64.encodeToString(bytes, 0, total, Base64.NO_WRAP));
                call.resolve(payload);
            } catch (Exception error) {
                call.reject("读取 WebDAV 下载文件失败。", error);
            }
        });
    }

    @PluginMethod
    public void releaseDownloadFile(PluginCall call) {
        String downloadId = call.getString("downloadId");
        delete(downloadId == null ? null : downloads.remove(downloadId));
        call.resolve();
    }

    @PluginMethod
    public void beginUploadFile(PluginCall call) {
        String url = required(call, "url");
        if (url == null) return;
        try {
            String uploadId = UUID.randomUUID().toString();
            uploads.put(uploadId, new StagedUpload(
                temporaryFile(UPLOAD_PREFIX),
                url,
                call.getString("username", ""),
                call.getString("password", ""),
                call.getString("mimeType", "application/zip")
            ));
            JSObject payload = new JSObject();
            payload.put("uploadId", uploadId);
            call.resolve(payload);
        } catch (Exception error) {
            call.reject("创建 WebDAV 上传会话失败。", error);
        }
    }

    @PluginMethod
    public void appendUploadFileChunk(PluginCall call) {
        StagedUpload upload = upload(call);
        if (upload == null) return;
        String dataBase64 = call.getString("dataBase64");
        if (dataBase64 == null) {
            call.reject("WebDAV 上传分块内容不完整。");
            return;
        }
        executor.execute(() -> {
            try {
                byte[] bytes = Base64.decode(dataBase64, Base64.DEFAULT);
                synchronized (upload) {
                    try (FileOutputStream output = new FileOutputStream(upload.file, true)) {
                        output.write(bytes);
                    }
                }
                call.resolve();
            } catch (Exception error) {
                call.reject("写入 WebDAV 上传分块失败。", error);
            }
        });
    }

    @PluginMethod
    public void finishUploadFile(PluginCall call) {
        String uploadId = call.getString("uploadId");
        StagedUpload upload = uploadId == null ? null : uploads.remove(uploadId);
        if (upload == null) {
            call.reject("WebDAV 上传会话不存在。");
            return;
        }
        executor.execute(() -> {
            try {
                WebDavHttpTransport.Result result = transport.uploadFile(
                    upload.url,
                    upload.username,
                    upload.password,
                    upload.mimeType,
                    upload.file
                );
                call.resolve(resultPayload(result));
            } catch (Exception error) {
                rejectNetwork(call, "上传 WebDAV 备份失败", error);
            } finally {
                delete(upload.file);
            }
        });
    }

    @PluginMethod
    public void cancelUploadFile(PluginCall call) {
        String uploadId = call.getString("uploadId");
        StagedUpload upload = uploadId == null ? null : uploads.remove(uploadId);
        delete(upload == null ? null : upload.file);
        call.resolve();
    }

    @PluginMethod
    public void uploadFile(PluginCall call) {
        String url = required(call, "url");
        String dataBase64 = call.getString("dataBase64");
        if (url == null) return;
        if (dataBase64 == null) {
            call.reject("WebDAV 上传内容格式不正确。");
            return;
        }
        executor.execute(() -> {
            File source = null;
            try {
                source = temporaryFile(UPLOAD_PREFIX);
                try (FileOutputStream output = new FileOutputStream(source)) {
                    output.write(Base64.decode(dataBase64, Base64.DEFAULT));
                }
                WebDavHttpTransport.Result result = transport.uploadFile(
                    url,
                    call.getString("username", ""),
                    call.getString("password", ""),
                    call.getString("mimeType", "application/zip"),
                    source
                );
                call.resolve(resultPayload(result));
            } catch (Exception error) {
                rejectNetwork(call, "上传 WebDAV 备份失败", error);
            } finally {
                delete(source);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        downloads.values().forEach(WebDavPlugin::delete);
        uploads.values().forEach((upload) -> delete(upload.file));
        downloads.clear();
        uploads.clear();
        executor.shutdownNow();
    }

    private String required(PluginCall call, String key) {
        String value = call.getString(key);
        if (value == null || value.trim().isEmpty()) {
            call.reject("WebDAV 地址不正确。");
            return null;
        }
        return value;
    }

    private StagedUpload upload(PluginCall call) {
        String uploadId = call.getString("uploadId");
        StagedUpload upload = uploadId == null ? null : uploads.get(uploadId);
        if (upload == null) call.reject("WebDAV 上传会话不存在。");
        return upload;
    }

    private File temporaryFile(String prefix) throws Exception {
        File directory = new File(getContext().getCacheDir(), "polaris-webdav");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("无法创建 WebDAV 临时目录。");
        }
        return File.createTempFile(prefix, ".tmp", directory);
    }

    private static JSObject resultPayload(WebDavHttpTransport.Result result) {
        JSObject payload = new JSObject();
        payload.put("statusCode", result.statusCode);
        if (!result.mimeType.isEmpty()) payload.put("mimeType", result.mimeType);
        return payload;
    }

    private static void rejectNetwork(PluginCall call, String action, Exception error) {
        String detail = error.getMessage() == null ? "" : error.getMessage().trim();
        call.reject(detail.isEmpty() ? action : action + "：" + detail, error);
    }

    private static void delete(File file) {
        if (file != null && file.exists()) file.delete();
    }
}
