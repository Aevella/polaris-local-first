package com.alyssa.polaris;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;

/**
 * 这组用例锁的是 1.0.71 上「导入文件分块范围无效」的根因：
 * bridge 送过来的偏移量在 JSON 里解析成 Integer，而 Capacitor 的 getLong 只认 Long。
 */
public class PluginCallNumbersTest {
    /** bridge 实际递过来的就是一段 JSON 文本，这里按同样的方式还原。 */
    private static JSONObject bridgePayload(String json) throws JSONException {
        return new JSONObject(json);
    }

    @Test
    public void bridgeIntegersDoNotArriveAsLong() throws JSONException {
        JSONObject data = bridgePayload("{\"offset\":578129920,\"length\":262144}");

        // 这两条就是 Capacitor getLong 失手的地方：instanceof Long 为假，于是返回 null。
        assertFalse(data.opt("offset") instanceof Long);
        assertTrue(data.opt("offset") instanceof Integer);
    }

    @Test
    public void readsBridgeIntegersThatCapacitorGetLongWouldMiss() throws JSONException {
        JSONObject data = bridgePayload("{\"offset\":578129920,\"length\":262144}");

        assertEquals(578129920L, PluginCallNumbers.readLong(data, "offset"));
        assertEquals(262144L, PluginCallNumbers.readLong(data, "length"));
    }

    @Test
    public void readsZeroOffsetAsZeroRatherThanMissing() throws JSONException {
        JSONObject data = bridgePayload("{\"offset\":0,\"length\":1}");

        assertEquals(0L, PluginCallNumbers.readLong(data, "offset"));
    }

    @Test
    public void readsOffsetsBeyondIntRange() throws JSONException {
        JSONObject data = bridgePayload("{\"offset\":4294967296}");

        assertTrue(data.opt("offset") instanceof Long);
        assertEquals(4294967296L, PluginCallNumbers.readLong(data, "offset"));
    }

    @Test
    public void fallsBackWhenParameterIsMissingOrUnreadable() throws JSONException {
        JSONObject data = bridgePayload("{\"offset\":\"哪里\"}");

        assertEquals(-1L, PluginCallNumbers.readLong(data, "offset"));
        assertEquals(-1L, PluginCallNumbers.readLong(data, "length"));
        assertEquals(-1L, PluginCallNumbers.readLong(null, "offset"));
        assertEquals(7L, PluginCallNumbers.readLong(data, "length", 7L));
    }
}
