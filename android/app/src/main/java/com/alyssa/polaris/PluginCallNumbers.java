package com.alyssa.polaris;

import org.json.JSONObject;

/**
 * 从插件调用参数里读取整数。
 *
 * <p>Capacitor 的 {@code PluginCall#getLong} / {@code PluginCall#getInt} 只做严格的
 * {@code instanceof} 判断，不做任何数值收敛：
 *
 * <pre>
 * Object value = this.data.opt(name);
 * if (value instanceof Long) return (Long) value;
 * return defaultValue;
 * </pre>
 *
 * <p>而 JSON 文本里塞得进 int 的整数会被解析成 {@link Integer}，塞不进的才是 {@link Long}。
 * 于是 {@code getLong} 对一切小于 2^31 的值恒定返回 null，{@code getInt} 则对一切不小于
 * 2^31 的值恒定返回 null——两个方法各瞎一半，且瞎的区间正好互补。
 *
 * <p>这里统一走 {@link JSONObject#optLong} 的收敛读取，Integer、Long、Double 与数字字符串
 * 都能正确落到 long 上，调用方只需判负。
 */
final class PluginCallNumbers {
    private PluginCallNumbers() {}

    /** 读不到、读不动或参数缺失时返回 {@code fallback}。 */
    static long readLong(JSONObject data, String name, long fallback) {
        if (data == null) {
            return fallback;
        }
        return data.optLong(name, fallback);
    }

    /** 读不到时返回 -1，交给调用方按「非法范围」处理。 */
    static long readLong(JSONObject data, String name) {
        return readLong(data, name, -1L);
    }
}
