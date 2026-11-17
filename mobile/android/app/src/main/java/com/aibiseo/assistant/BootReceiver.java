package com.aibiseo.assistant;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

/** 폰을 켜면: '폰 켤 때 캐릭터 띄우기'를 켜 둔 경우 캐릭터를 다시 띄운다. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        if (Prefs.autoStart(ctx) && Settings.canDrawOverlays(ctx)) OverlayService.start(ctx);
    }
}
