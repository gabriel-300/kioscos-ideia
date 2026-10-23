package ar.com.angirufood.reparto;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Android 13+: sin este permiso la notificación fija "Compartiendo tu ubicación" queda oculta
        // (el servicio igual corre, pero el repartidor no vería que se está compartiendo). El plugin de
        // ubicación no lo pide, así que se pide acá, una sola vez al abrir la app.
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7001);
        }
    }
}
