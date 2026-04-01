/** pos_product_lot_list/static/src/js/Screens/ProductScreen/stock_check_patch.js */
import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";

const OriginalAdd = ProductScreen.prototype.addProductToOrder;

patch(ProductScreen.prototype, {
    async addProductToOrder(product) {
        try {
            // ------------- Determinar variantId (robusto) -------------
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

            // Si no pudimos determinar una variante, dejamos seguir el flujo original
            if (!variantId) {
                return await OriginalAdd.call(this, product);
            }

            // Si el producto (template) es COMBO, **no** verificar stock aquí:
            // dejamos que se abra el configurador; la comprobación la hará el popup.
            // --- DETECCIÓN ROBUSTA DE TEMPLATE / isCombo ---
            let tmpl = null;
            try {
                // 1) Si product.product_tmpl_id existe y es un objeto (posiblemente ya es el template)
                if (product && product.product_tmpl_id && typeof product.product_tmpl_id === "object") {
                    tmpl = product.product_tmpl_id;
                }
                // 2) Si es un array tipo [id, name]
                else if (product && Array.isArray(product.product_tmpl_id)) {
                    const tid = product.product_tmpl_id[0];
                    tmpl = this.pos.models["product.template"]?.get(tid);
                }
                // 3) Si es un número (id)
                else if (product && typeof product.product_tmpl_id === "number") {
                    tmpl = this.pos.models["product.template"]?.get(product.product_tmpl_id);
                }
                // 4) Si el product **es** ya un template (no tiene product_tmpl_id pero tiene combo_ids)
                else if (product && product.combo_ids) {
                    tmpl = product;
                }
                // 5) Fallback: intentar buscar template por el id si product.product_tmpl_id tiene .id (caso raro)
                else if (product && product.product_tmpl_id && product.product_tmpl_id.id) {
                    tmpl = this.pos.models["product.template"]?.get(product.product_tmpl_id.id);
                }
            } catch (e) {
                console.warn("Error resolviendo template:", e);
                tmpl = null;
            }

            console.log("DEBUG product", product);
            console.log("DEBUG product.product_tmpl_id", product && product.product_tmpl_id);
            console.log("DEBUG tmpl resolved", tmpl);
            
            // Determinar si es combo: soporte isCombo() (función), isCombo bool, o combo_ids
            const isCombo =
                !!tmpl &&
                (tmpl.isCombo === true ||
                    (typeof tmpl.isCombo === "function" && tmpl.isCombo()) ||
                    (Array.isArray(tmpl.combo_ids) && tmpl.combo_ids.length > 0) ||
                    (tmpl.combo_ids && typeof tmpl.combo_ids === "object" && Object.keys(tmpl.combo_ids).length > 0));
            
            if (isCombo) {
                // es combo -> no comprobamos stock aquí, abrimos configurador
                return await OriginalAdd.call(this, product);
            }

            // 2) Obtener location_id desde la configuración del POS (soporte varios nombres)
            const cfg = this.pos.config || {};
            const location_id =
                (cfg.ubicacion_id && cfg.ubicacion_id[0]) ||
                (cfg.stock_location_id && cfg.stock_location_id[0]) ||
                (cfg.stock_location && cfg.stock_location[0]);

            // 3) COMPROBACIÓN FIABLE: leer qty_available del producto (variant)
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
                console.error("Error leyendo qty_available:", e);
                // fallback a permitir (o leer stock.quant si prefieres)
                return await OriginalAdd.call(this, product);
            }

            // Si no hay stock, bloquear y notificar
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