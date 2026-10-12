package se.cuplex.bridgebuilder;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

/**
 * Google Play Billing for the one-time unlock of the full game: a non-consumable in-app product.
 * Ownership is read from Play on every start, so a refund closes the chapters again and a new
 * phone on the same Google account opens them. Purchases are acknowledged here, as Play refunds
 * any that aren't within three days.
 */
@CapacitorPlugin(name = "PlayBilling")
public class PlayBillingPlugin extends Plugin {

    private BillingClient client;
    private boolean ready;
    private final List<Runnable> waiting = new ArrayList<>();
    private final List<PluginCall> failing = new ArrayList<>();
    /** The product last asked about, and its details once Play has sent them. */
    private String product;
    private ProductDetails details;
    /** A buy() waiting for Play's purchase flow to finish. */
    private PluginCall buying;

    @Override
    public void load() {
        client = BillingClient.newBuilder(getContext())
            .setListener(this::onPurchasesUpdated)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build();
    }

    /** Runs once Play billing is connected, or rejects the call if it can't be. */
    private void whenReady(PluginCall call, Runnable then) {
        if (ready) {
            then.run();
            return;
        }
        synchronized (waiting) {
            waiting.add(then);
            failing.add(call);
            if (waiting.size() > 1) return;
        }
        client.startConnection(
            new BillingClientStateListener() {
                @Override
                public void onBillingSetupFinished(BillingResult result) {
                    List<Runnable> run;
                    List<PluginCall> calls;
                    synchronized (waiting) {
                        run = new ArrayList<>(waiting);
                        calls = new ArrayList<>(failing);
                        waiting.clear();
                        failing.clear();
                    }
                    ready = result.getResponseCode() == BillingClient.BillingResponseCode.OK;
                    if (ready) for (Runnable r : run) r.run();
                    else for (PluginCall c : calls) c.resolve(status(false, false, false));
                }

                @Override
                public void onBillingServiceDisconnected() {
                    ready = false;
                }
            }
        );
    }

    private JSObject status(boolean available, boolean owned, boolean pending) {
        JSObject o = new JSObject();
        o.put("available", available);
        o.put("owned", owned);
        if (pending) o.put("pending", true);
        if (details != null && details.getOneTimePurchaseOfferDetails() != null) {
            o.put("price", details.getOneTimePurchaseOfferDetails().getFormattedPrice());
        }
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        product = call.getString("product");
        whenReady(call, () -> queryDetails(() -> queryOwned(call)));
    }

    @PluginMethod
    public void restore(PluginCall call) {
        status(call);
    }

    @PluginMethod
    public void buy(PluginCall call) {
        product = call.getString("product");
        whenReady(call, () ->
            queryDetails(() -> {
                if (details == null) {
                    call.reject("The full game is not on sale in Google Play yet");
                    return;
                }
                BillingFlowParams params = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(List.of(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(details).build()))
                    .build();
                buying = call;
                getActivity().runOnUiThread(() -> {
                    BillingResult r = client.launchBillingFlow(getActivity(), params);
                    if (r.getResponseCode() == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
                        buying = null;
                        queryOwned(call);
                    } else if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        buying = null;
                        call.reject(r.getDebugMessage().isEmpty() ? "Google Play could not start the purchase" : r.getDebugMessage());
                    }
                });
            })
        );
    }

    /** Fetches the product's details (its price) once, then carries on either way. */
    private void queryDetails(Runnable then) {
        if (details != null && details.getProductId().equals(product)) {
            then.run();
            return;
        }
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                List.of(QueryProductDetailsParams.Product.newBuilder().setProductId(product).setProductType(BillingClient.ProductType.INAPP).build())
            )
            .build();
        client.queryProductDetailsAsync(params, (result, found) -> {
            List<ProductDetails> list = found.getProductDetailsList();
            if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && !list.isEmpty()) details = list.get(0);
            then.run();
        });
    }

    /** Asks Play what this account owns, acknowledging a fresh purchase, and answers the call. */
    private void queryOwned(PluginCall call) {
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(), (result, purchases) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.resolve(status(false, false, false));
                return;
            }
            call.resolve(judge(purchases));
        });
    }

    /** What a list of purchases means for the full game. */
    private JSObject judge(List<Purchase> purchases) {
        boolean owned = false;
        boolean pending = false;
        for (Purchase p : purchases) {
            if (!p.getProducts().contains(product)) continue;
            if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                owned = true;
                if (!p.isAcknowledged()) {
                    client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(), r -> {});
                }
            } else if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) pending = true;
        }
        return status(true, owned, pending && !owned);
    }

    /** Play's answer to a purchase flow, or a pending purchase that went through later. */
    private void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        PluginCall call = buying;
        buying = null;
        int code = result.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
            JSObject s = judge(purchases);
            if (call != null) call.resolve(s);
            else notifyListeners("change", s);
        } else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED && call != null) {
            queryOwned(call);
        } else if (call != null) {
            if (code == BillingClient.BillingResponseCode.USER_CANCELED) call.resolve(status(true, false, false));
            else call.reject(result.getDebugMessage().isEmpty() ? "The purchase did not go through" : result.getDebugMessage());
        }
    }
}
