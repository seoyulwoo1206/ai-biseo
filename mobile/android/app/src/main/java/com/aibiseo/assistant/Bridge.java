package com.aibiseo.assistant;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 화면(자바스크립트) ↔ 폰 기능 연결: window.AndroidBridge
 * 앱 화면(MainActivity)과 떠 있는 캐릭터(OverlayService)가 같이 쓴다.
 */
final class Bridge {
    /** 떠 있는 캐릭터 창 조절 (OverlayService 만) */
    interface Overlay {
        void setShape(String json);

        void dragStart();

        boolean moveBy(double dx, double dy);

        void dragEnd();

        void setStage(int css);
    }

    /** 음성 인식 (앱 화면만) */
    interface Voice {
        void listen();
    }

    private final Context ctx;
    private final WebView web;
    private final Overlay overlay;
    private final Voice voice;
    private final Activity activity;
    private TextToSpeech tts;
    private boolean ttsReady;
    private String ttsPending;

    Bridge(Context ctx, WebView web, Overlay overlay, Voice voice, Activity activity) {
        this.ctx = ctx.getApplicationContext();
        this.web = web;
        this.overlay = overlay;
        this.voice = voice;
        this.activity = activity;
    }

    void shutdown() {
        if (tts != null) tts.shutdown();
    }

    /** 자바스크립트 함수 부르기 (문자열 하나 넘김) */
    void call(String fn, String arg) {
        String js = "window." + fn + "&&window." + fn + "(" + JSONObject.quote(arg == null ? "" : arg) + ")";
        web.post(() -> web.evaluateJavascript(js, null));
    }

    // ---------- 알림 ----------
    @JavascriptInterface
    public void notify(String title, String body) {
        Notifier.show(ctx, Notifier.CH_REMIND, (int) (System.currentTimeMillis() % 100000), title, body);
    }

    @JavascriptInterface
    public void scheduleAlarm(String id, double at, String title) {
        AlarmReceiver.schedule(ctx, id, (long) at, title);
    }

    @JavascriptInterface
    public void cancelAlarm(String id) {
        AlarmReceiver.cancel(ctx, id);
    }

    // ---------- 열기 ----------
    @JavascriptInterface
    public void openUrl(String url) {
        if (url == null || !url.startsWith("http")) return;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } catch (Exception ignored) {
            // 열 앱이 없으면 그만
        }
    }

    private static final Map<String, String[]> ALIASES = new HashMap<>();

    static {
        ALIASES.put("카톡", new String[] {"카카오톡", "kakaotalk"});
        ALIASES.put("카카오", new String[] {"카카오톡", "kakaotalk"});
        ALIASES.put("크롬", new String[] {"chrome"});
        ALIASES.put("구글크롬", new String[] {"chrome"});
        ALIASES.put("유튜브", new String[] {"youtube"});
        ALIASES.put("유튜브뮤직", new String[] {"youtubemusic"});
        ALIASES.put("인스타", new String[] {"instagram"});
        ALIASES.put("인스타그램", new String[] {"instagram"});
        ALIASES.put("갤러리", new String[] {"갤러리", "gallery", "사진", "photos"});
        ALIASES.put("사진", new String[] {"갤러리", "사진", "photos", "gallery"});
        ALIASES.put("메모", new String[] {"삼성notes", "samsungnotes", "메모", "keep메모", "keep"});
        ALIASES.put("알람앱", new String[] {"시계", "clock"});
        ALIASES.put("시계", new String[] {"시계", "clock"});
        ALIASES.put("설정", new String[] {"설정", "settings"});
        ALIASES.put("계산기", new String[] {"계산기", "calculator"});
        ALIASES.put("카메라", new String[] {"카메라", "camera"});
        ALIASES.put("지도", new String[] {"네이버지도", "카카오맵", "지도", "maps"});
        ALIASES.put("플레이스토어", new String[] {"playstore", "play스토어"});
        ALIASES.put("체크메이트", new String[] {"체크메이트"});
    }

    private static String norm(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT).replaceAll("[\\s._\\-()]", "");
    }

    /** "카톡 열어줘": 폰에 깔린 앱을 이름으로 찾아 연다. 연 앱 이름(없으면 빈 문자열) */
    @JavascriptInterface
    public String openApp(String name) {
        PackageManager pm = ctx.getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> list = pm.queryIntentActivities(main, 0);
        String q = norm(name);
        if (q.isEmpty()) return "";
        String[] wanted = ALIASES.containsKey(q) ? ALIASES.get(q) : new String[0];
        ResolveInfo best = null;
        String bestLabel = null;
        int bestScore = Integer.MAX_VALUE;
        for (ResolveInfo ri : list) {
            String label = String.valueOf(ri.loadLabel(pm));
            String key = norm(label);
            int score = Integer.MAX_VALUE;
            for (int i = 0; i < wanted.length; i++) if (key.equals(norm(wanted[i]))) score = Math.min(score, i);
            if (key.equals(q)) score = Math.min(score, 10);
            else if (key.contains(q) || (q.length() >= 3 && q.contains(key))) score = Math.min(score, 100 + key.length());
            if (score < bestScore) {
                bestScore = score;
                best = ri;
                bestLabel = label;
            }
        }
        if (best == null) return "";
        Intent launch = pm.getLaunchIntentForPackage(best.activityInfo.packageName);
        if (launch == null) return "";
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(launch);
        return bestLabel;
    }

    /** 앱 화면 열기 (떠 있는 캐릭터를 누르면 설정·물어보기를 앱에서 보여 준다) */
    @JavascriptInterface
    public void showApp(String open) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (open != null && !open.isEmpty()) i.putExtra("open", open);
        ctx.startActivity(i);
    }

    // ---------- 떠 있는 캐릭터 켜고 끄기 ----------
    @JavascriptInterface
    public void setOverlay(boolean on) {
        Prefs.setOverlayWanted(ctx, on);
        if (!on) {
            OverlayService.stop(ctx);
            return;
        }
        if (!Settings.canDrawOverlays(ctx)) {
            // '다른 앱 위에 표시' 허락 화면으로 (허락하고 돌아오면 MainActivity 가 띄운다)
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return;
        }
        OverlayService.start(ctx);
        // 앱 화면은 뒤로 보내서 바로 떠 있는 캐릭터가 보이게
        if (activity != null) activity.runOnUiThread(() -> activity.moveTaskToBack(true));
    }

    @JavascriptInterface
    public boolean isOverlayOn() {
        return OverlayService.running;
    }

    @JavascriptInterface
    public void setAutoStart(boolean on) {
        Prefs.setAutoStart(ctx, on);
    }

    @JavascriptInterface
    public boolean isAutoStart() {
        return Prefs.autoStart(ctx);
    }

    @JavascriptInterface
    public void quit() {
        Prefs.setOverlayWanted(ctx, false);
        OverlayService.stop(ctx);
    }

    // ---------- 말하기 · 듣기 ----------
    @JavascriptInterface
    public void speak(String text) {
        if (tts == null) {
            ttsPending = text;
            tts = new TextToSpeech(ctx, status -> {
                ttsReady = status == TextToSpeech.SUCCESS;
                if (ttsReady) {
                    tts.setLanguage(Locale.KOREAN);
                    tts.setPitch(1.15f);
                    tts.setSpeechRate(1.05f);
                    if (ttsPending != null) tts.speak(ttsPending, TextToSpeech.QUEUE_FLUSH, null, "aibiseo");
                    ttsPending = null;
                }
            });
            return;
        }
        if (ttsReady) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "aibiseo");
        else ttsPending = text;
    }

    @JavascriptInterface
    public void stopSpeak() {
        ttsPending = null;
        if (tts != null && ttsReady) tts.stop();
    }

    @JavascriptInterface
    public void listen() {
        if (voice != null) voice.listen();
        else {
            // 떠 있는 캐릭터에서는 앱 화면의 물어보기로
            call("__aibiseoVoice", "");
            showApp("ask");
        }
    }

    void voiceResult(String text) {
        call("__aibiseoVoice", text);
    }

    // ---------- 떠 있는 캐릭터 창 (앱 화면에서는 하는 일 없음) ----------
    @JavascriptInterface
    public void setShape(String json) {
        if (overlay != null) overlay.setShape(json);
    }

    @JavascriptInterface
    public void dragStart() {
        if (overlay != null) overlay.dragStart();
    }

    @JavascriptInterface
    public boolean moveBy(double dx, double dy) {
        return overlay != null && overlay.moveBy(dx, dy);
    }

    @JavascriptInterface
    public void dragEnd() {
        if (overlay != null) overlay.dragEnd();
    }

    @JavascriptInterface
    public void setStage(int css) {
        if (overlay != null) overlay.setStage(css);
    }
}
