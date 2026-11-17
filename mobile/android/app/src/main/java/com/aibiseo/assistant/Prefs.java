package com.aibiseo.assistant;

import android.content.Context;
import android.content.SharedPreferences;

/** 자바 쪽에서만 쓰는 설정 (자동 실행, 떠 있는 캐릭터 위치) */
final class Prefs {
    private Prefs() {}

    private static SharedPreferences p(Context ctx) {
        return ctx.getSharedPreferences("aibiseo", Context.MODE_PRIVATE);
    }

    static boolean autoStart(Context ctx) {
        return p(ctx).getBoolean("autoStart", true);
    }

    static void setAutoStart(Context ctx, boolean on) {
        p(ctx).edit().putBoolean("autoStart", on).apply();
    }

    static boolean overlayWanted(Context ctx) {
        return p(ctx).getBoolean("overlay", false);
    }

    static void setOverlayWanted(Context ctx, boolean on) {
        p(ctx).edit().putBoolean("overlay", on).apply();
    }

    /** 캐릭터 발밑 가운데 위치 (화면 픽셀). 없으면 -1 */
    static int[] anchor(Context ctx) {
        return new int[] {p(ctx).getInt("ax", -1), p(ctx).getInt("ay", -1)};
    }

    static void setAnchor(Context ctx, int x, int y) {
        p(ctx).edit().putInt("ax", x).putInt("ay", y).apply();
    }
}
