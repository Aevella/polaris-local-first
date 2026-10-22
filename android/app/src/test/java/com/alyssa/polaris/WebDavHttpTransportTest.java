package com.alyssa.polaris;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import okhttp3.Credentials;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okio.Buffer;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class WebDavHttpTransportTest {
    private MockWebServer server;
    private WebDavHttpTransport transport;

    @Before
    public void setUp() throws IOException {
        server = new MockWebServer();
        server.start();
        transport = new WebDavHttpTransport(new OkHttpClient());
    }

    @After
    public void tearDown() throws IOException {
        server.shutdown();
    }

    @Test
    public void listsDirectoryWithNativePropfindAndBasicAuth() throws Exception {
        server.enqueue(new MockResponse()
            .setResponseCode(207)
            .setHeader("Content-Type", "application/xml")
            .setBody("<multistatus/>"));

        WebDavHttpTransport.Result result = transport.listDirectory(
            server.url("/dav/").toString(),
            "angel@example.com",
            "app-password"
        );
        RecordedRequest request = server.takeRequest();

        assertEquals(207, result.statusCode);
        assertEquals("<multistatus/>", result.body);
        assertEquals("PROPFIND", request.getMethod());
        assertEquals("1", request.getHeader("Depth"));
        assertEquals(
            Credentials.basic("angel@example.com", "app-password"),
            request.getHeader("Authorization")
        );
    }

    @Test
    public void streamsUploadFileWithPut() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(201));
        File source = File.createTempFile("polaris-webdav-upload", ".zip");
        Files.write(source.toPath(), new byte[] { 80, 75, 3, 4, 9 });

        try {
            WebDavHttpTransport.Result result = transport.uploadFile(
                server.url("/dav/polaris.zip").toString(),
                "user",
                "password",
                "application/zip",
                source
            );
            RecordedRequest request = server.takeRequest();

            assertEquals(201, result.statusCode);
            assertEquals("PUT", request.getMethod());
            assertArrayEquals(new byte[] { 80, 75, 3, 4, 9 }, request.getBody().readByteArray());
        } finally {
            source.delete();
        }
    }

    @Test
    public void streamsDownloadedBackupToDisk() throws Exception {
        byte[] backup = new byte[] { 80, 75, 3, 4, 10, 11, 12 };
        server.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/zip")
            .setBody(new Buffer().write(backup)));
        File target = File.createTempFile("polaris-webdav-download", ".zip");

        try {
            WebDavHttpTransport.Result result = transport.downloadFile(
                server.url("/dav/latest.zip").toString(),
                "user",
                "password",
                target
            );
            RecordedRequest request = server.takeRequest();

            assertEquals(200, result.statusCode);
            assertEquals("GET", request.getMethod());
            assertEquals(backup.length, result.byteLength);
            assertArrayEquals(backup, Files.readAllBytes(target.toPath()));
        } finally {
            target.delete();
        }
    }

}
