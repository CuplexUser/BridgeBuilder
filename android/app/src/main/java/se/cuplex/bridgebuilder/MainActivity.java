package se.cuplex.bridgebuilder;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Draw behind the system bars on every Android version, as Capacitor's SystemBars docs advise.
        // The page keeps its HUD clear of them with env(safe-area-inset-*).
        EdgeToEdge.enable(this);
    }
}
