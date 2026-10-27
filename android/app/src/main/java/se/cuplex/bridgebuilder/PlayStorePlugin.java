package se.cuplex.bridgebuilder;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The game's page on Google Play, for players who want to rate it. The Play Store app opens on
 * it; a device without one gets the page in the browser.
 */
@CapacitorPlugin(name = "PlayStore")
public class PlayStorePlugin extends Plugin {

    @PluginMethod
    public void openListing(PluginCall call) {
        String id = getContext().getPackageName();
        Intent store = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + id)).setPackage("com.android.vending");
        Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + id));
        try {
            getActivity().startActivity(store);
        } catch (ActivityNotFoundException e) {
            try {
                getActivity().startActivity(web);
            } catch (ActivityNotFoundException e2) {
                call.reject("Nothing can open Google Play");
                return;
            }
        }
        call.resolve();
    }
}
