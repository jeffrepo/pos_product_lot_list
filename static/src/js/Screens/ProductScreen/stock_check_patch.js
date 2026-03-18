/** pos_product_lot_list/static/src/js/Screens/ProductScreen/stock_check_patch.js */
import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";

const OriginalAdd = ProductScreen.prototype.addProductToOrder;

patch(ProductScreen.prototype, {
    async addProductToOrder(product) {
        try {
            // 1) Intentar obtener un product variant id válido
            let variantId = null;

            if (product && product.product_variant_ids && product.product_variant_ids.length) {
                variantId = product.product_variant_ids[0].id;
            } else if (product && product.product_tmpl_id) {
                variantId = product.id;
            } else if (product && product.id) {
                try {
                    const found = await this.pos.data.searchRead(
                        "product.product",
                        [["product_tmpl_id", "=", product.id], ["available_in_pos", "=", true]],
                        ["id"],
                        { limit: 1 }
                    );
                    if (found && found.length) {
                        variantId = found[0].id;
                    } else {
                        const maybeVariant = this.pos.models["product.product"]?.get(product.id);
                        if (maybeVariant) {
                            variantId = product.id;
                        }
                    }
                } catch (e) {
                    console.error("Error buscando variante fallback:", e);
                }
            }

            if (!variantId) {
                return await OriginalAdd.call(this, product);
            }

            // Obtener location si lo necesitas (lo dejamos por compatibilidad)
            const cfg = this.pos.config || {};
            const location_id =
                (cfg.ubicacion_id && cfg.ubicacion_id[0]) ||
                (cfg.stock_location_id && cfg.stock_location_id[0]) ||
                (cfg.stock_location && cfg.stock_location[0]);

            // --- NUEVA LÓGICA: leer qty_available del producto (más fiable) ---
            let totalQty = 0;
            try {
                const prodInfo = await this.pos.data.searchRead(
                    "product.product",
                    [["id", "=", variantId]],
                    ["qty_available"],
                    { limit: 1 }
                );
                totalQty = (prodInfo && prodInfo.length) ? Number(prodInfo[0].qty_available || 0) : 0;
            } catch (e) {
                console.error("Error reading product qty_available:", e);
                // fallback: intentar leer stock.quant como antes (si realmente quieres mantener el fallback)
                try {
                    const domain = location_id
                        ? [["product_id", "=", variantId], ["location_id", "=", location_id]]
                        : [["product_id", "=", variantId]];
                    const quants = await this.pos.data.searchRead("stock.quant", domain, ["quantity"], { limit: 100 });
                    totalQty = (quants && quants.length)
                        ? quants.reduce((acc, q) => acc + (Number(q.quantity) || 0), 0)
                        : 0;
                } catch (err2) {
                    console.error("Fallback error reading stock.quant:", err2);
                    // si todo falla, permitimos flujo original
                    return await OriginalAdd.call(this, product);
                }
            }

            // Bloquear si no hay stock
            if (totalQty <= 0) {
                this.notification.add(
                    _t('No hay existencias disponibles para "%s".', product?.name || ""),
                    { type: "warning", title: _t("Sin stock") }
                );
                return;
            }

            // Si hay stock, delegar al comportamiento original
            return await OriginalAdd.call(this, product);
        } catch (err) {
            console.error("Error en stock_check_patch addProductToOrder:", err);
            return await OriginalAdd.call(this, product);
        }
    },
});