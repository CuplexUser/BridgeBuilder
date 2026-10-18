package se.cuplex.bridgebuilder;

import android.content.Intent;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.games.AuthenticationResult;
import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.SnapshotsClient;
import com.google.android.gms.games.snapshot.Snapshot;
import com.google.android.gms.games.snapshot.SnapshotMetadataChange;
import com.google.android.gms.tasks.Task;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * Google Play Games Services for the game: sign-in, achievements, leaderboards and a cloud save.
 *
 * Achievements and leaderboards are named by key: "first_crossing" is the string resource
 * achievement_first_crossing in res/values/games-ids.xml, the file the Play Console's "Get
 * resources" gives. A key with no resource is skipped, and with no project id in that file the
 * whole plugin stays off, so builds work before the Play Console is set up.
 */
@CapacitorPlugin(name = "PlayGames")
public class PlayGamesPlugin extends Plugin {

    private static final String TAG = "PlayGames";

    private boolean available;

    @Override
    public void load() {
        // BridgeBuilderApp has started Play Games if the build has a project id.
        boolean services = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext()) == ConnectionResult.SUCCESS;
        available = services && BridgeBuilderApp.hasPlayGames(getActivity().getApplication());
    }

    @PluginMethod
    public void status(PluginCall call) {
        if (!available) {
            call.resolve(status(false, null));
            return;
        }
        answer(call, PlayGames.getGamesSignInClient(getActivity()).isAuthenticated());
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        if (!available) {
            call.resolve(status(false, null));
            return;
        }
        answer(call, PlayGames.getGamesSignInClient(getActivity()).signIn());
    }

    /** Resolves with the sign-in state and, when signed in, the player's name. */
    private void answer(PluginCall call, Task<AuthenticationResult> auth) {
        auth.addOnCompleteListener(t -> {
            boolean signedIn = t.isSuccessful() && t.getResult().isAuthenticated();
            if (!signedIn) {
                call.resolve(status(false, null));
                return;
            }
            PlayGames.getPlayersClient(getActivity())
                .getCurrentPlayer()
                .addOnCompleteListener(p -> call.resolve(status(true, p.isSuccessful() ? p.getResult().getDisplayName() : null)));
        });
    }

    private JSObject status(boolean signedIn, String player) {
        JSObject o = new JSObject();
        o.put("available", available);
        o.put("signedIn", signedIn);
        if (player != null) o.put("player", player);
        return o;
    }

    /** The Play Console id behind a key, or null if the build doesn't have it. */
    private String id(String prefix, String key) {
        if (key == null) return null;
        int res = getContext().getResources().getIdentifier(prefix + key, "string", getContext().getPackageName());
        if (res == 0) return null;
        String id = getContext().getString(res).trim();
        return id.isEmpty() ? null : id;
    }

    /**
     * Unlocks and scores wait for Play Games' answer, so the game only counts one as sent once it
     * got there, and tries a failed one again later.
     */
    @PluginMethod
    public void unlock(PluginCall call) {
        String key = call.getString("key");
        String id = id("achievement_", key);
        if (!available || id == null) {
            fail(call, available ? "No achievement id for " + key : "Google Play Games is not available", null);
            return;
        }
        settle(call, PlayGames.getAchievementsClient(getActivity()).unlockImmediate(id), "unlock " + key);
    }

    @PluginMethod
    public void submitScore(PluginCall call) {
        String key = call.getString("key");
        String id = id("leaderboard_", key);
        // Not getLong: Capacitor hands a small JS number over as an Integer, which getLong turns into null.
        JSObject data = call.getData();
        Long score = data.has("score") ? data.optLong("score") : null;
        if (!available || id == null || score == null) {
            String why = !available ? "Google Play Games is not available" : id == null ? "No leaderboard id for " + key : "No score for " + key;
            fail(call, why, null);
            return;
        }
        settle(call, PlayGames.getLeaderboardsClient(getActivity()).submitScoreImmediate(id, score), "submit a score to " + key);
    }

    /** The outcome goes to logcat too, since a release build keeps the web console quiet. */
    private void settle(PluginCall call, Task<?> task, String what) {
        task.addOnCompleteListener(t -> {
            if (t.isSuccessful()) {
                Log.i(TAG, "Did " + what);
                call.resolve();
            } else fail(call, "Could not " + what + ": " + t.getException(), t.getException());
        });
    }

    private void fail(PluginCall call, String message, Exception e) {
        Log.w(TAG, message, e);
        call.reject(message, e);
    }

    @PluginMethod
    public void showAchievements(PluginCall call) {
        if (!available) {
            call.reject("Google Play Games is not available");
            return;
        }
        show(call, PlayGames.getAchievementsClient(getActivity()).getAchievementsIntent());
    }

    @PluginMethod
    public void showLeaderboards(PluginCall call) {
        if (!available) {
            call.reject("Google Play Games is not available");
            return;
        }
        show(call, PlayGames.getLeaderboardsClient(getActivity()).getAllLeaderboardsIntent());
    }

    private void show(PluginCall call, Task<Intent> intent) {
        intent.addOnCompleteListener(t -> {
            if (t.isSuccessful()) startActivityForResult(call, t.getResult(), "shown");
            else call.reject("Google Play Games could not be reached");
        });
    }

    @ActivityCallback
    private void shown(PluginCall call, ActivityResult result) {
        call.resolve();
    }

    @PluginMethod
    public void loadSave(PluginCall call) {
        if (!available) {
            call.resolve(new JSObject().put("data", null));
            return;
        }
        SnapshotsClient snapshots = PlayGames.getSnapshotsClient(getActivity());
        snapshots
            .open(call.getString("name", "progress"), true, SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED)
            .addOnCompleteListener(t -> {
                if (!t.isSuccessful() || t.getResult().isConflict()) {
                    call.reject("The cloud save could not be opened");
                    return;
                }
                Snapshot snapshot = t.getResult().getData();
                try {
                    byte[] bytes = snapshot.getSnapshotContents().readFully();
                    JSObject o = new JSObject();
                    o.put("data", bytes.length == 0 ? null : new String(bytes, StandardCharsets.UTF_8));
                    call.resolve(o);
                } catch (IOException e) {
                    call.reject("The cloud save could not be read", e);
                } finally {
                    snapshots.discardAndClose(snapshot);
                }
            });
    }

    @PluginMethod
    public void writeSave(PluginCall call) {
        String data = call.getString("data");
        if (!available || data == null) {
            call.resolve();
            return;
        }
        SnapshotsClient snapshots = PlayGames.getSnapshotsClient(getActivity());
        snapshots
            .open(call.getString("name", "progress"), true, SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED)
            .addOnCompleteListener(t -> {
                if (!t.isSuccessful() || t.getResult().isConflict()) {
                    call.reject("The cloud save could not be opened");
                    return;
                }
                Snapshot snapshot = t.getResult().getData();
                snapshot.getSnapshotContents().writeBytes(data.getBytes(StandardCharsets.UTF_8));
                SnapshotMetadataChange change = new SnapshotMetadataChange.Builder().setDescription(call.getString("description", "")).build();
                snapshots.commitAndClose(snapshot, change).addOnCompleteListener(c -> {
                    if (c.isSuccessful()) call.resolve();
                    else call.reject("The cloud save could not be written");
                });
            });
    }
}
