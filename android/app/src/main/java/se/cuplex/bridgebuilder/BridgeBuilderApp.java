package se.cuplex.bridgebuilder;

import android.app.Application;
import com.google.android.gms.games.PlayGamesSdk;

/**
 * Starts Play Games as the app starts, as Google advises, but only once the build carries a Play
 * Games project id (res/values/games-ids.xml). The library's own start-up provider is removed in
 * the manifest, since it would start without one.
 */
public class BridgeBuilderApp extends Application {

    /** The build has a Play Games project id. */
    static boolean hasPlayGames(Application app) {
        return !app.getString(R.string.app_id).trim().isEmpty();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        if (hasPlayGames(this)) PlayGamesSdk.initialize(this);
    }
}
