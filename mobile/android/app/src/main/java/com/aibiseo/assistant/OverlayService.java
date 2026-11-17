package com.aibiseo.assistant;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.view.Gravity;
import android.view.WindowManager;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 다른 앱 위에 떠 있는 캐릭터.
 * 평소에는 캐릭터 크기만 한 작은 창이라 나머지 화면은 뒤쪽 앱이 그대로 터치를 받고,
 * 말풍선이 뜨면 잠깐 창을 키운다. 창의 기준점은 '캐릭터 발밑 가운데'.
 */
public class OverlayService extends Service implements Bridge.Overlay {
    static volatile boolean running;
    private static OverlayService instance;

    private final Handler main = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private WebView web;
    private Bridge bridge;
    private WindowManager.LayoutParams lp;
    private float density;
    private int stageCss = 144;
    private boolean full;
    private boolean hidden;
    private int ax;
    private int ay;

    static void start(Context ctx) {
        ctx.startForegroundService(new Intent(ctx, OverlayService.class));
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, OverlayService.class));
    }

    /** 앱 화면이 앞에 있는 동안은 숨긴다 (캐릭터가 두 마리 보이지 않게). 두뇌는 계속 돈다. */
    static void setHidden(boolean h) {
        OverlayService s = instance;
        if (s != null) s.main.post(() -> {
            s.hidden = h;
            s.apply();
        });
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        instance = this;
        Notifier.channels(this);
        Notification n = new Notification.Builder(this, Notifier.CH_FLOAT)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("AI 비서가 화면에 있어요")
                .setContentText("눌러서 앱 열기")
                .setContentIntent(Notifier.openApp(this, null, 1))
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, n);

        wm = getSystemService(WindowManager.class);
        density = getResources().getDisplayMetrics().density;
        web = new WebView(this);
        AppWeb.setup(web, this);
        bridge = new Bridge(this, web, this, null, null);
        web.addJavascriptInterface(bridge, "AndroidBridge");
        web.setOnTouchListener((v, e) -> {
            rawX = e.getRawX();
            rawY = e.getRawY();
            return false; // 터치는 화면(캐릭터)도 그대로 받는다
        });

        lp = new WindowManager.LayoutParams(
                1, 1,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;

        hidden = MainActivity.visible; // 앱 화면이 앞에 있으면 숨긴 채로 시작
        int[] saved = Prefs.anchor(this);
        Rect scr = screen();
        if (saved[0] >= 0) {
            ax = saved[0];
            ay = saved[1];
        } else {
            // 처음: 오른쪽 아래
            ax = scr.width() - Math.round((stageCss / 2f + 16) * density);
            ay = scr.height() - Math.round(110 * density);
        }
        apply();
        wm.addView(web, lp);
        web.loadUrl(AppWeb.BASE + "overlay.html");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (instance == this) instance = null;
        try {
            wm.removeView(web);
        } catch (Exception ignored) {
            // 이미 없으면 그만
        }
        web.destroy();
        bridge.shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Rect screen() {
        return wm.getCurrentWindowMetrics().getBounds();
    }

    private int cssW() {
        return full ? Math.max(320, stageCss + 100) : stageCss + 40;
    }

    private int cssH() {
        int max = Math.round(screen().height() / density * 0.85f);
        return full ? Math.min(stageCss + 470, max) : stageCss + 36;
    }

    /** 창 크기·위치를 지금 상태에 맞춘다 (메인 스레드에서) */
    private void apply() {
        Rect scr = screen();
        int w = Math.round(cssW() * density);
        int half = Math.round((stageCss / 2f) * density);
        ax = Math.max(half / 2, Math.min(scr.width() - half / 2, ax));
        ay = Math.max(Math.round((stageCss + 36) * density), Math.min(scr.height(), ay));
        // 창 아래끝 = 캐릭터 발밑 (항상). 화면 위쪽에 가까우면 말풍선 창을 그만큼 짧게.
        int h = Math.min(Math.round(cssH() * density), ay);
        lp.width = w;
        lp.height = h;
        int x = ax - w / 2;
        if (full) {
            // 말풍선 창은 화면 안에 들어오게 밀어 넣고, 밀린 만큼 캐릭터만 반대로 옮겨 제자리에 보이게 한다
            int fit = Math.max(0, Math.min(scr.width() - w, x));
            setShift(Math.round((x - fit) / density));
            x = fit;
        } else setShift(0);
        lp.x = x;
        lp.y = ay - h;
        // NOT_TOUCH_MODAL: 창 바깥 터치는 항상 뒤쪽 앱으로 (이게 없으면 말풍선이 떠 있는 동안 화면 전체가 막힌다)
        int f = WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL;
        // 말풍선이 떠 있을 때만 글자 입력(할 일 추가)을 받을 수 있게
        if (!full) f |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        if (hidden) f |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        lp.flags = f;
        lp.alpha = hidden ? 0f : 1f;
        if (web != null && web.isAttachedToWindow()) wm.updateViewLayout(web, lp);
    }

    private int shift = 0;

    private void setShift(int css) {
        if (css == shift || web == null) return;
        shift = css;
        web.evaluateJavascript("document.documentElement.style.setProperty('--shift','" + css + "px')", null);
    }

    // ---------- Bridge.Overlay ----------
    @Override
    public void setShape(String json) {
        boolean wantFull = false;
        try {
            JSONArray rects = new JSONArray(json);
            float viewH = lp.height / density;
            float stageTop = viewH - stageCss - 12;
            for (int i = 0; i < rects.length(); i++) {
                JSONObject r = rects.getJSONObject(i);
                // 캐릭터 머리보다 위에 뭔가(말풍선·이모티콘) 있으면 큰 창
                if (r.optDouble("y", 0) < stageTop - 4) wantFull = true;
            }
        } catch (Exception ignored) {
            return;
        }
        if (wantFull == full) return;
        boolean f = wantFull;
        main.post(() -> {
            full = f;
            apply();
        });
    }

    // 끌기: 화면에서 손가락의 '진짜 위치'(raw)를 직접 읽어서, 잡은 순간부터 움직인 만큼만 옮긴다.
    // (창 기준 좌표를 쓰면 창이 옮겨지는 사이에 같은 거리가 두 번 더해져서 손가락보다 앞서 나간다)
    private volatile float rawX;
    private volatile float rawY;
    private float startRawX;
    private float startRawY;
    private int startAx;
    private int startAy;

    @Override
    public void dragStart() {
        main.post(() -> {
            startRawX = rawX;
            startRawY = rawY;
            startAx = ax;
            startAy = ay;
        });
    }

    @Override
    public boolean moveBy(double dx, double dy) {
        CountDownLatch done = new CountDownLatch(1);
        main.post(() -> {
            ax = startAx + Math.round(rawX - startRawX);
            ay = startAy + Math.round(rawY - startRawY);
            apply();
            done.countDown();
        });
        try {
            // 창이 실제로 옮겨진 뒤에 대답해야 손가락을 따라올 때 떨리지 않는다
            done.await(150, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        return true;
    }

    @Override
    public void dragEnd() {
        main.post(() -> Prefs.setAnchor(this, ax, ay));
    }

    @Override
    public void setStage(int css) {
        main.post(() -> {
            if (css <= 0 || css == stageCss) return;
            stageCss = css;
            apply();
        });
    }
}
