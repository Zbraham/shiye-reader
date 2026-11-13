package com.shiye.reader;

import android.graphics.Color;
import android.os.Build;
import android.view.Window;
import android.view.WindowInsets;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps both system bars in step with the in-app paper/night theme.
 *
 * The stock StatusBar plugin only touches the status bar, which leaves a black
 * navigation bar (and light icons) under the cream paper theme. This plugin
 * sets the colour and icon appearance of both bars together.
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    @PluginMethod
    public void setStyle(PluginCall call) {
        final String color = call.getString("color", "#F7F4EC");
        final boolean darkIcons = !Boolean.FALSE.equals(call.getBoolean("darkIcons", true));

        getActivity().runOnUiThread(() -> {
            try {
                Window window = getActivity().getWindow();
                WindowInsetsControllerCompat controller =
                        WindowCompat.getInsetsController(window, window.getDecorView());
                controller.setAppearanceLightStatusBars(darkIcons);
                controller.setAppearanceLightNavigationBars(darkIcons);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    window.setNavigationBarContrastEnforced(false);
                }
                window.setStatusBarColor(Color.parseColor(color));
                window.setNavigationBarColor(Color.parseColor(color));

                JSObject result = new JSObject();
                WindowInsets rootInsets = window.getDecorView().getRootWindowInsets();
                if (rootInsets != null) {
                    WindowInsetsCompat compat =
                            WindowInsetsCompat.toWindowInsetsCompat(rootInsets, window.getDecorView());
                    float density = getContext().getResources().getDisplayMetrics().density;
                    int topPx = compat.getInsets(WindowInsetsCompat.Type.statusBars()).top;
                    int bottomPx = compat
                            .getInsets(WindowInsetsCompat.Type.navigationBars())
                            .bottom;
                    result.put("topInset", topPx / density);
                    result.put("bottomInset", bottomPx / density);
                } else {
                    result.put("topInset", 0);
                    result.put("bottomInset", 0);
                }
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not style system bars", error);
            }
        });
    }
}
