package com.shiye.reader;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;
import okio.BufferedSource;

/**
 * Streams OpenAI-compatible chat completions without going through the WebView
 * fetch stack. This keeps SSE delivery intact and avoids CORS restrictions when
 * the user points the app at a local model server.
 */
@CapacitorPlugin(name = "NativeHttp")
public class NativeHttpPlugin extends Plugin {

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final Map<String, Call> active = new ConcurrentHashMap<>();
    private OkHttpClient client;

    @Override
    public void load() {
        client = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(60, TimeUnit.SECONDS)
                .readTimeout(300, TimeUnit.SECONDS)
                .build();
    }

    @PluginMethod
    public void postStream(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        String body = call.getString("body", "");
        Integer timeout = call.getInt("timeoutMs", 300000);
        JSObject headers = call.getObject("headers", new JSObject());

        if (id == null || id.isEmpty() || url == null || url.isEmpty()) {
            call.reject("invalid_request", "invalid_request");
            return;
        }

        Request.Builder builder = new Request.Builder()
                .url(url)
                .post(RequestBody.create(body, JSON));

        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            String value = headers.getString(key);
            if (key != null && value != null) {
                try {
                    builder.header(key, value);
                } catch (IllegalArgumentException ignored) {
                    // Skip malformed header names instead of failing the request.
                }
            }
        }

        int timeoutMs = timeout == null ? 300000 : timeout;
        OkHttpClient requestClient = client.newBuilder()
                .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .build();

        Call okCall = requestClient.newCall(builder.build());
        active.put(id, okCall);

        okCall.enqueue(new Callback() {
            @Override
            public void onFailure(Call failed, IOException error) {
                active.remove(id);
                if (failed.isCanceled()) {
                    call.reject("aborted", "aborted");
                } else if (error instanceof InterruptedIOException) {
                    call.reject("timeout", "timeout");
                } else {
                    String message = error.getMessage();
                    call.reject(message == null || message.isEmpty() ? "network" : message, "network");
                }
            }

            @Override
            public void onResponse(Call answered, Response response) {
                ResponseBody responseBody = response.body();
                String contentType = response.header("Content-Type", "");
                StringBuilder all = new StringBuilder();

                try {
                    JSObject meta = new JSObject();
                    meta.put("id", id);
                    meta.put("status", response.code());
                    meta.put("contentType", contentType == null ? "" : contentType);
                    notifyListeners("meta", meta);

                    if (responseBody != null) {
                        BufferedSource source = responseBody.source();
                        Buffer buffer = new Buffer();
                        long read;
                        while ((read = source.read(buffer, 8192)) != -1) {
                            String text = buffer.readUtf8();
                            if (text.isEmpty()) continue;
                            all.append(text);
                            JSObject chunk = new JSObject();
                            chunk.put("id", id);
                            chunk.put("text", text);
                            notifyListeners("chunk", chunk);
                        }
                    }

                    JSObject result = new JSObject();
                    result.put("status", response.code());
                    result.put("contentType", contentType == null ? "" : contentType);
                    result.put("body", all.toString());
                    active.remove(id);
                    call.resolve(result);
                } catch (Exception error) {
                    active.remove(id);
                    if (answered.isCanceled() || error instanceof InterruptedIOException) {
                        call.reject("aborted", "aborted");
                    } else {
                        String message = error.getMessage();
                        call.reject(message == null || message.isEmpty() ? "stream" : message, "stream");
                    }
                } finally {
                    response.close();
                }
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id != null) {
            Call running = active.remove(id);
            if (running != null) running.cancel();
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (Call running : active.values()) {
            running.cancel();
        }
        active.clear();
        super.handleOnDestroy();
    }
}
