package com.aibiseo.assistant;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;

/** 폰 알림 (일정·할 일 알림, 알람, 떠 있는 캐릭터 상태) */
final class Notifier {
    static final String CH_REMIND = "remind";
    static final String CH_ALARM = "alarm";
    static final String CH_FLOAT = "float";

    private Notifier() {}

    static void channels(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel remind = new NotificationChannel(CH_REMIND, "일정·할 일 알림", NotificationManager.IMPORTANCE_HIGH);
        remind.setDescription("체크메이트 일정과 할 일 시간이 되면 알려 줘요");
        NotificationChannel alarm = new NotificationChannel(CH_ALARM, "알람", NotificationManager.IMPORTANCE_HIGH);
        alarm.setDescription("비서한테 맞춰 달라고 한 알람·타이머");
        alarm.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        alarm.enableVibration(true);
        NotificationChannel fl = new NotificationChannel(CH_FLOAT, "떠 있는 캐릭터", NotificationManager.IMPORTANCE_MIN);
        fl.setDescription("캐릭터가 화면 위에 떠 있는 동안 보이는 알림");
        nm.createNotificationChannel(remind);
        nm.createNotificationChannel(alarm);
        nm.createNotificationChannel(fl);
    }

    static PendingIntent openApp(Context ctx, String open, int code) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (open != null) i.putExtra("open", open);
        return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static void show(Context ctx, String channel, int id, String title, String body) {
        channels(ctx);
        Notification n = new Notification.Builder(ctx, channel)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setCategory(CH_ALARM.equals(channel) ? Notification.CATEGORY_ALARM : Notification.CATEGORY_REMINDER)
                .setContentIntent(openApp(ctx, null, id))
                .build();
        ctx.getSystemService(NotificationManager.class).notify(id, n);
    }
}
