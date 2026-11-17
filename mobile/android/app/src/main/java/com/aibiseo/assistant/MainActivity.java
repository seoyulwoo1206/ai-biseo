package com.aibiseo.assistant;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import android.view.WindowInsets;
import android.webkit.WebView;
import android.window.OnBackInvokedDispatcher;

import java.util.ArrayList;

/** 앱 화면: 캐릭터 + 설정 · 물어보기 · 로그인 (아이폰 웹앱과 같은 화면 파일) */
public class MainActivity extends Activity implements Bridge.Voice {
    private static final int REQ_VOICE = 7;
    private static final int REQ_PERM = 8;

    /** 앱 화면이 앞에 보이는 중인지 (떠 있는 캐릭터가 이때는 숨는다) */
    static volatile boolean visible;

    private WebView web;
    private Bridge bridge;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Notifier.channels(this);
        web = new WebView(this);
        AppWeb.setup(web, this);
        bridge = new Bridge(this, web, null, this, this);
        web.addJavascriptInterface(bridge, "AndroidBridge");
        // 상태 표시줄·내비게이션 막대 밑으로 화면이 들어가지 않게
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
        setContentView(web);

        String open = getIntent().getStringExtra("open");
        web.loadUrl(AppWeb.BASE + "index.html" + (open != null ? "?open=" + open : ""));

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, REQ_PERM);
        }
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }
    }

    /** 뒤로 가기: 열린 시트가 있으면 닫고, 없으면 앱을 뒤로 보낸다 (비서는 계속 돈다) */
    private void goBack() {
        web.evaluateJavascript("window.__aibiseoBack ? window.__aibiseoBack() : false", v -> {
            if (!"true".equals(v)) moveTaskToBack(true);
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBack();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String open = intent.getStringExtra("open");
        if (open != null) bridge.call("__aibiseoOpen", open);
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        OverlayService.setHidden(true);
        // '다른 앱 위에 표시'를 허락하고 돌아왔으면 바로 띄운다
        if (Prefs.overlayWanted(this) && Settings.canDrawOverlays(this) && !OverlayService.running) {
            OverlayService.start(this);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        visible = false;
        OverlayService.setHidden(false);
    }

    @Override
    protected void onDestroy() {
        bridge.shutdown();
        web.destroy();
        super.onDestroy();
    }

    // ---------- 음성 인식: 폰의 음성 입력 창을 띄운다 ----------
    @Override
    public void listen() {
        runOnUiThread(() -> {
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR");
            i.putExtra(RecognizerIntent.EXTRA_PROMPT, "말해 줘!");
            try {
                startActivityForResult(i, REQ_VOICE);
            } catch (ActivityNotFoundException e) {
                bridge.voiceResult("");
            }
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != REQ_VOICE) return;
        String text = "";
        if (result == RESULT_OK && data != null) {
            ArrayList<String> list = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (list != null && !list.isEmpty()) text = list.get(0);
        }
        bridge.voiceResult(text);
    }
}
