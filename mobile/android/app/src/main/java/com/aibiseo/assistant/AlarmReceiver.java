package com.aibiseo.assistant;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** 비서한테 맞춘 알람·타이머: 앱이 꺼져 있어도 폰이 대신 울려 준다. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String title = intent.getStringExtra("title");
        Notifier.show(ctx, Notifier.CH_ALARM, intent.getIntExtra("code", 1), title == null ? "알람 시간이야! ⏰" : title, "AI 비서가 알려 줘요");
    }

    private static PendingIntent pending(Context ctx, String id, String title) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction("alarm:" + id);
        int code = 1000 + (id.hashCode() & 0xffff);
        i.putExtra("title", title);
        i.putExtra("code", code);
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static void schedule(Context ctx, String id, long at, String title) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        PendingIntent p = pending(ctx, id, title);
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p);
    }

    static void cancel(Context ctx, String id) {
        ctx.getSystemService(AlarmManager.class).cancel(pending(ctx, id, null));
    }
}
