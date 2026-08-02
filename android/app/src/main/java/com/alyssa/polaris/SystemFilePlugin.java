package com.alyssa.polaris;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@CapacitorPlugin(name = "SystemFile")
public class SystemFilePlugin extends Plugin {
    private static final int BUFFER_BYTES = 1024 * 1024;
    private static final String DEFAULT_BACKUP_MIME_TYPE = "application/zip";

    private final ExecutorService fileExecutor = Executors.newSingleThreadExecutor();
    private final Map<String, File> pendingExportFiles = new ConcurrentHashMap<>();
    private final Map<String, File> stagedStreamingExports = new ConcurrentHashMap<>();
    private final Map<String, ZipExportSession> stagedZipExports = new ConcurrentHashMap<>();

    @PluginMethod
    public void importBackup(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
            DEFAULT_BACKUP_MIME_TYPE,
            "application/x-zip-compressed",
            "application/octet-stream"
        });
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "handleImportBackupResult");
    }

    @PluginMethod
    public void importFiles(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(resolveAcceptMimeType(call.getString("accept")));
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, Boolean.TRUE.equals(call.getBoolean("multiple", false)));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "handleImportFilesResult");
    }

    @ActivityCallback
    private void handleImportBackupResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject canceled = new JSObject();
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }

        fileExecutor.execute(() -> {
            try {
                ContentResolver resolver = getContext().getContentResolver();
                String name = sanitizeFileName(readDisplayName(resolver, uri));
                if (name.isEmpty()) {
                    name = "polaris-backup-" + UUID.randomUUID() + ".zip";
                }
                String mimeType = resolver.getType(uri);
                File destination = new File(ensureDirectory("imports"), UUID.randomUUID() + "-" + name);
                try (InputStream input = resolver.openInputStream(uri)) {
                    if (input == null) {
                        throw new SystemFileException("系统文件没有返回可读取内容。");
                    }
                    copy(input, destination);
                }

                JSObject response = new JSObject();
                response.put("canceled", false);
                response.put("name", name);
                response.put("mimeType", mimeType == null ? DEFAULT_BACKUP_MIME_TYPE : mimeType);
                response.put("fileUrl", Uri.fromFile(destination).toString());
                call.resolve(response);
            } catch (Exception error) {
                call.reject("读取系统备份文件失败。", error);
            }
        });
    }

    @ActivityCallback
    private void handleImportFilesResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        List<Uri> uris = selectedUris(data);
        if (result.getResultCode() != Activity.RESULT_OK || uris.isEmpty()) {
            JSObject canceled = new JSObject();
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }

        fileExecutor.execute(() -> {
            try {
                ContentResolver resolver = getContext().getContentResolver();
                JSArray files = new JSArray();
                for (Uri uri : uris) {
                    String name = sanitizeFileName(readDisplayName(resolver, uri));
                    if (name.isEmpty()) {
                        name = "polaris-file-" + UUID.randomUUID();
                    }
                    String mimeType = resolver.getType(uri);
                    File destination = new File(ensureDirectory("imports"), UUID.randomUUID() + "-" + name);
                    try (InputStream input = resolver.openInputStream(uri)) {
                        if (input == null) {
                            throw new SystemFileException("系统文件没有返回可读取内容。");
                        }
                        copy(input, destination);
                    }

                    JSObject file = new JSObject();
                    file.put("name", name);
                    file.put("mimeType", mimeType == null ? "application/octet-stream" : mimeType);
                    file.put("fileUrl", Uri.fromFile(destination).toString());
                    files.put(file);
                }

                JSObject response = new JSObject();
                response.put("canceled", false);
                response.put("files", files);
                call.resolve(response);
            } catch (Exception error) {
                call.reject("读取系统文件失败。", error);
            }
        });
    }

    @PluginMethod
    public void exportBackup(PluginCall call) {
        String fileName = sanitizeFileName(call.getString("fileName"));
        String dataBase64 = call.getString("dataBase64");
        if (fileName.isEmpty()) {
            call.reject("缺少导出文件名。");
            return;
        }
        if (dataBase64 == null || dataBase64.isEmpty()) {
            call.reject("导出内容格式不正确。");
            return;
        }

        fileExecutor.execute(() -> {
            try {
                byte[] bytes = Base64.decode(dataBase64, Base64.DEFAULT);
                File staged = new File(ensureDirectory("exports"), UUID.randomUUID() + "-" + fileName);
                try (FileOutputStream output = new FileOutputStream(staged)) {
                    output.write(bytes);
                }
                pendingExportFiles.put(call.getCallbackId(), staged);

                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(call.getString("mimeType", DEFAULT_BACKUP_MIME_TYPE));
                intent.putExtra(Intent.EXTRA_TITLE, fileName);
                intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                getActivity().runOnUiThread(() -> startActivityForResult(call, intent, "handleExportBackupResult"));
            } catch (Exception error) {
                call.reject("准备导出备份文件失败。", error);
            }
        });
    }

    @PluginMethod
    public void beginExportBackup(PluginCall call) {
        String fileName = sanitizeFileName(call.getString("fileName"));
        if (fileName.isEmpty()) {
            call.reject("缺少导出文件名。");
            return;
        }

        fileExecutor.execute(() -> {
            try {
                String exportId = UUID.randomUUID().toString();
                File staged = new File(ensureDirectory("exports"), exportId + "--" + fileName);
                deleteQuietly(staged);
                if (!staged.createNewFile()) {
                    throw new SystemFileException("创建导出临时文件失败。");
                }
                stagedStreamingExports.put(exportId, staged);

                JSObject response = new JSObject();
                response.put("exportId", exportId);
                call.resolve(response);
            } catch (Exception error) {
                call.reject("创建导出会话失败。", error);
            }
        });
    }

    @PluginMethod
    public void appendExportBackupChunk(PluginCall call) {
        String exportId = call.getString("exportId");
        String dataBase64 = call.getString("dataBase64");
        if (exportId == null || dataBase64 == null) {
            call.reject("导出分块格式不正确。");
            return;
        }

        fileExecutor.execute(() -> {
            try {
                File staged = stagedStreamingExports.get(exportId);
                if (staged == null) {
                    throw new SystemFileException("导出会话不存在。");
                }
                try (FileOutputStream output = new FileOutputStream(staged, true)) {
                    output.write(Base64.decode(dataBase64, Base64.DEFAULT));
                }
                call.resolve();
            } catch (Exception error) {
                call.reject("写入导出分块失败。", error);
            }
        });
    }

    @PluginMethod
    public void finishExportBackup(PluginCall call) {
        String exportId = call.getString("exportId");
        if (exportId == null) {
            call.reject("导出会话不存在。");
            return;
        }

        File staged = stagedStreamingExports.remove(exportId);
        if (staged == null || !staged.exists()) {
            call.reject("导出临时文件不存在。");
            return;
        }
        pendingExportFiles.put(call.getCallbackId(), staged);
        String fileName = readableExportName(staged.getName());

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", DEFAULT_BACKUP_MIME_TYPE));
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        startActivityForResult(call, intent, "handleExportBackupResult");
    }

    @PluginMethod
    public void cancelExportBackup(PluginCall call) {
        String exportId = call.getString("exportId");
        if (exportId != null) {
            deleteQuietly(stagedStreamingExports.remove(exportId));
        }
        call.resolve();
    }

    @PluginMethod
    public void beginZipExport(PluginCall call) {
        String fileName = sanitizeFileName(call.getString("fileName"));
        if (fileName.isEmpty()) {
            call.reject("缺少导出文件名。");
            return;
        }

        fileExecutor.execute(() -> {
            try {
                String exportId = UUID.randomUUID().toString();
                File staged = new File(ensureDirectory("exports"), exportId + "--" + fileName);
                deleteQuietly(staged);
                ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(staged));
                stagedZipExports.put(exportId, new ZipExportSession(staged, zip));

                JSObject response = new JSObject();
                response.put("exportId", exportId);
                call.resolve(response);
            } catch (Exception error) {
                call.reject("创建 ZIP 导出会话失败。", error);
            }
        });
    }

    @PluginMethod
    public void addZipTextEntry(PluginCall call) {
        String exportId = call.getString("exportId");
        String path = call.getString("path");
        String text = call.getString("text", "");
        fileExecutor.execute(() -> {
            try {
                ZipExportSession session = requireZipSession(exportId);
                session.beginEntry(path);
                session.write(text.getBytes(StandardCharsets.UTF_8));
                session.finishEntry();
                call.resolve();
            } catch (Exception error) {
                call.reject("写入 ZIP 文本条目失败。", error);
            }
        });
    }

    @PluginMethod
    public void beginZipTextEntry(PluginCall call) {
        beginZipEntry(call);
    }

    @PluginMethod
    public void appendZipTextChunk(PluginCall call) {
        String exportId = call.getString("exportId");
        String text = call.getString("text", "");
        fileExecutor.execute(() -> {
            try {
                requireZipSession(exportId).write(text.getBytes(StandardCharsets.UTF_8));
                call.resolve();
            } catch (Exception error) {
                call.reject("写入 ZIP 文本分块失败。", error);
            }
        });
    }

    @PluginMethod
    public void finishZipTextEntry(PluginCall call) {
        finishZipEntry(call);
    }

    @PluginMethod
    public void beginZipBinaryEntry(PluginCall call) {
        beginZipEntry(call);
    }

    @PluginMethod
    public void appendZipBinaryChunk(PluginCall call) {
        String exportId = call.getString("exportId");
        String dataBase64 = call.getString("dataBase64");
        if (dataBase64 == null) {
            call.reject("ZIP 二进制分块格式不正确。");
            return;
        }

        fileExecutor.execute(() -> {
            try {
                requireZipSession(exportId).write(Base64.decode(dataBase64, Base64.DEFAULT));
                call.resolve();
            } catch (Exception error) {
                call.reject("写入 ZIP 二进制分块失败。", error);
            }
        });
    }

    @PluginMethod
    public void addZipNativePersistenceBinaryEntry(PluginCall call) {
        JSObject response = new JSObject();
        response.put("written", false);
        call.resolve(response);
    }

    @PluginMethod
    public void finishZipBinaryEntry(PluginCall call) {
        finishZipEntry(call);
    }

    @PluginMethod
    public void finishZipExport(PluginCall call) {
        String exportId = call.getString("exportId");
        if (exportId == null) {
            call.reject("ZIP 导出会话不存在。");
            return;
        }

        fileExecutor.execute(() -> {
            try {
                ZipExportSession session = stagedZipExports.remove(exportId);
                if (session == null) {
                    throw new SystemFileException("ZIP 导出会话不存在。");
                }
                session.close();
                pendingExportFiles.put(call.getCallbackId(), session.file);
                String fileName = readableExportName(session.file.getName());

                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(call.getString("mimeType", DEFAULT_BACKUP_MIME_TYPE));
                intent.putExtra(Intent.EXTRA_TITLE, fileName);
                intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                getActivity().runOnUiThread(() -> startActivityForResult(call, intent, "handleExportBackupResult"));
            } catch (Exception error) {
                call.reject("完成 ZIP 导出失败。", error);
            }
        });
    }

    @PluginMethod
    public void cancelZipExport(PluginCall call) {
        String exportId = call.getString("exportId");
        fileExecutor.execute(() -> {
            ZipExportSession session = exportId == null ? null : stagedZipExports.remove(exportId);
            if (session != null) {
                session.closeQuietly();
                deleteQuietly(session.file);
            }
            call.resolve();
        });
    }

    @ActivityCallback
    private void handleExportBackupResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        File staged = pendingExportFiles.remove(call.getCallbackId());
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            deleteQuietly(staged);
            JSObject canceled = new JSObject();
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }
        if (staged == null || !staged.exists()) {
            call.reject("导出临时文件不存在。");
            return;
        }

        fileExecutor.execute(() -> {
            try (InputStream input = new FileInputStream(staged);
                 OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) {
                    throw new SystemFileException("系统文件没有返回可写入位置。");
                }
                copy(input, output);
                JSObject response = new JSObject();
                response.put("canceled", false);
                call.resolve(response);
            } catch (Exception error) {
                call.reject("写入系统备份文件失败。", error);
            } finally {
                deleteQuietly(staged);
            }
        });
    }

    private File ensureDirectory(String name) throws SystemFileException {
        File directory = new File(getContext().getCacheDir(), "system-file/" + name);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new SystemFileException("创建系统文件缓存目录失败。");
        }
        return directory;
    }

    private void beginZipEntry(PluginCall call) {
        String exportId = call.getString("exportId");
        String path = call.getString("path");
        fileExecutor.execute(() -> {
            try {
                requireZipSession(exportId).beginEntry(path);
                call.resolve();
            } catch (Exception error) {
                call.reject("创建 ZIP 条目失败。", error);
            }
        });
    }

    private void finishZipEntry(PluginCall call) {
        String exportId = call.getString("exportId");
        fileExecutor.execute(() -> {
            try {
                requireZipSession(exportId).finishEntry();
                call.resolve();
            } catch (Exception error) {
                call.reject("完成 ZIP 条目失败。", error);
            }
        });
    }

    private ZipExportSession requireZipSession(String exportId) throws SystemFileException {
        if (exportId == null) {
            throw new SystemFileException("ZIP 导出会话不存在。");
        }
        ZipExportSession session = stagedZipExports.get(exportId);
        if (session == null) {
            throw new SystemFileException("ZIP 导出会话不存在。");
        }
        return session;
    }

    private static void copy(InputStream input, File destination) throws Exception {
        try (OutputStream output = new FileOutputStream(destination)) {
            copy(input, output);
        }
    }

    private static void copy(InputStream input, OutputStream output) throws Exception {
        byte[] buffer = new byte[BUFFER_BYTES];
        int read;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
    }

    private static String readDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String value = cursor.getString(index);
                    return value == null ? "" : value;
                }
            }
        } catch (Exception ignored) {
            return "";
        }
        return "";
    }

    private static List<Uri> selectedUris(Intent data) {
        List<Uri> uris = new ArrayList<>();
        if (data == null) return uris;
        Uri single = data.getData();
        if (single != null) {
            uris.add(single);
        }
        ClipData clipData = data.getClipData();
        if (clipData != null) {
            for (int index = 0; index < clipData.getItemCount(); index += 1) {
                Uri uri = clipData.getItemAt(index).getUri();
                if (uri != null && !uris.contains(uri)) {
                    uris.add(uri);
                }
            }
        }
        return uris;
    }

    private static String resolveAcceptMimeType(String accept) {
        if (accept == null || accept.trim().isEmpty()) return "*/*";
        String first = accept.split(",", 2)[0].trim();
        if (first.isEmpty() || first.startsWith(".")) return "*/*";
        return first;
    }

    private static String sanitizeFileName(String value) {
        if (value == null) return "";
        return value.trim().replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private static String readableExportName(String stagedName) {
        int separator = stagedName.indexOf("--");
        return separator >= 0 && separator + 2 < stagedName.length()
            ? stagedName.substring(separator + 2)
            : stagedName;
    }

    private static void deleteQuietly(File file) {
        if (file != null && file.exists()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private static class SystemFileException extends Exception {
        SystemFileException(String message) {
            super(message);
        }
    }

    private static class ZipExportSession {
        final File file;
        final ZipOutputStream zip;
        boolean entryOpen = false;

        ZipExportSession(File file, ZipOutputStream zip) {
            this.file = file;
            this.zip = zip;
        }

        void beginEntry(String path) throws Exception {
            if (entryOpen) {
                throw new SystemFileException("已有 ZIP 条目正在写入。");
            }
            String safePath = safeZipPath(path);
            zip.putNextEntry(new ZipEntry(safePath));
            entryOpen = true;
        }

        void write(byte[] bytes) throws Exception {
            if (!entryOpen) {
                throw new SystemFileException("ZIP 条目尚未创建。");
            }
            zip.write(bytes);
        }

        void finishEntry() throws Exception {
            if (!entryOpen) {
                throw new SystemFileException("ZIP 条目尚未创建。");
            }
            zip.closeEntry();
            entryOpen = false;
        }

        void close() throws Exception {
            if (entryOpen) {
                zip.closeEntry();
                entryOpen = false;
            }
            zip.close();
        }

        void closeQuietly() {
            try {
                close();
            } catch (Exception ignored) {
                // Cleanup best effort only.
            }
        }

        private static String safeZipPath(String path) throws SystemFileException {
            if (path == null) {
                throw new SystemFileException("ZIP 条目路径不正确。");
            }
            String trimmed = path.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("/") || trimmed.contains("..")) {
                throw new SystemFileException("ZIP 条目路径不正确。");
            }
            return trimmed;
        }
    }
}
