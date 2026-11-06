package se.cuplex.bridgebuilder;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

/**
 * Rating the game on Google Play: Play's own rating card inside the game, or the game's page in the
 * Play Store app, or in the browser on a device without one.
 */
@CapacitorPlugin(name = "PlayStore")
public class PlayStorePlugin extends Plugin {

    /**
     * Asks Play for its rating card. Play decides whether it shows, within a quota of its own, and
     * never says whether it did or what the player chose, so this resolves either way. It rejects
     * only when Play can't be asked at all.
     */
    @PluginMethod
    public void requestReview(PluginCall call) {
        ReviewManager manager = ReviewManagerFactory.create(getContext());
        manager.requestReviewFlow().addOnCompleteListener(request -> {
            if (!request.isSuccessful()) {
                call.reject("Google Play can't ask for a review");
                return;
            }
            manager.launchReviewFlow(getActivity(), request.getResult()).addOnCompleteListener(flow -> call.resolve());
        });
    }

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
