package se.cuplex.bridgebuilder;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;

/**
 * Vibration with a shape: waveforms at chosen strengths and the phone's own tick and thud, which
 * Capacitor's Haptics plugin doesn't offer. Every effect ends by itself, so nothing can keep
 * buzzing if the game stalls; src/haptics.ts decides what plays.
 */
@CapacitorPlugin(name = "Rumble")
public class RumblePlugin extends Plugin {

    private Vibrator vibrator;

    @Override
    public void load() {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            vibrator = ((VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE)).getDefaultVibrator();
        } else {
            vibrator = getOldVibrator(context);
        }
    }

    @SuppressWarnings("deprecation")
    private static Vibrator getOldVibrator(Context context) {
        return (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
    }

    /** "full" has the phone's own tick and thud too, "amplitude" only waveforms, and "basic" neither. */
    @PluginMethod
    public void capabilities(PluginCall call) {
        String tier = "basic";
        if (vibrator.hasVibrator() && vibrator.hasAmplitudeControl()) {
            tier = hasPrimitives() ? "full" : "amplitude";
        }
        JSObject result = new JSObject();
        result.put("tier", tier);
        call.resolve(result);
    }

    /** Android 11 says yes to every primitive it's asked about, so these need Android 12. */
    private boolean hasPrimitives() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && vibrator.areAllPrimitivesSupported(VibrationEffect.Composition.PRIMITIVE_LOW_TICK, VibrationEffect.Composition.PRIMITIVE_THUD);
    }

    /** Plays a waveform once, replacing whatever is playing: each step's length in ms and strength, 0 to 255. */
    @PluginMethod
    public void play(PluginCall call) {
        JSArray timings = call.getArray("timings");
        JSArray amplitudes = call.getArray("amplitudes");
        if (timings == null || amplitudes == null || timings.length() == 0 || timings.length() != amplitudes.length()) {
            call.reject("A waveform needs a strength for each step");
            return;
        }
        long[] t = new long[timings.length()];
        int[] a = new int[t.length];
        try {
            for (int i = 0; i < t.length; i++) {
                t[i] = timings.getLong(i);
                a[i] = Math.max(0, Math.min(255, amplitudes.getInt(i)));
            }
        } catch (JSONException e) {
            call.reject("A waveform is made of numbers");
            return;
        }
        vibrator.vibrate(VibrationEffect.createWaveform(t, a, -1));
        call.resolve();
    }

    /** Plays the phone's own "tick" or "thud"; `scale` is how hard, 0 to 1. Asks for them only on the "full" tier. */
    @PluginMethod
    public void primitive(PluginCall call) {
        if (!hasPrimitives()) {
            call.reject("This phone has no primitives");
            return;
        }
        int id = "thud".equals(call.getString("name")) ? VibrationEffect.Composition.PRIMITIVE_THUD : VibrationEffect.Composition.PRIMITIVE_LOW_TICK;
        float scale = call.getFloat("scale", 1f);
        vibrator.vibrate(VibrationEffect.startComposition().addPrimitive(id, scale).compose());
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        vibrator.cancel();
        call.resolve();
    }

    /** Nothing buzzes once the game is out of sight. */
    @Override
    protected void handleOnPause() {
        vibrator.cancel();
    }
}
