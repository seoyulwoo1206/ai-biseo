package com.aibiseo.assistant;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * 앱 안에 넣어 둔 화면 파일(assets/www)을 https://appassets.androidplatform.net/www/ 주소로 보여 준다.
 * (진짜 인터넷 주소처럼 보이게 해야 저장소·모듈 스크립트가 제대로 동작한다)
 */
final class AppWeb {
    static final String HOST = "appassets.androidplatform.net";
    static final String BASE = "https://" + HOST + "/www/";

    private static final Map<String, String> TYPES = new HashMap<>();

    static {
        TYPES.put("html", "text/html");
        TYPES.put("js", "text/javascript");
        TYPES.put("css", "text/css");
        TYPES.put("png", "image/png");
        TYPES.put("json", "application/json");
        TYPES.put("webmanifest", "application/manifest+json");
    }

    private AppWeb() {}

    @SuppressLint("SetJavaScriptEnabled")
    static void setup(WebView web, Context ctx) {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // 알람 소리
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        web.setBackgroundColor(0x00000000);
        // 화면 쪽 오류를 logcat 에서 볼 수 있게
        web.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {
                android.util.Log.i("AiBiseoWeb", m.messageLevel() + " " + m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || !path.startsWith("/www/")) return null;
                String file = path.substring(1);
                if (file.endsWith("/")) file += "index.html";
                try {
                    InputStream in = ctx.getAssets().open(file);
                    String ext = file.substring(file.lastIndexOf('.') + 1);
                    String type = TYPES.containsKey(ext) ? TYPES.get(ext) : "application/octet-stream";
                    return new WebResourceResponse(type, "utf-8", in);
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                // 바깥 링크는 브라우저(또는 그 앱)로
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, u);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(i);
                } catch (Exception ignored) {
                    // 열 앱이 없으면 그만
                }
                return true;
            }
        });
    }
}
