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
                // Si el objeto recibido es una variante, product.id suele ser la variante
                // Si nos pasan el template, product.product_tmpl_id puede ser objeto/array/id
                // En cualquier caso, si este branch se ejecutó, interpretamos product como template
                // y no tenemos variante directa aún.
                variantId = product.id;
            } else if (product && product.id) {
                // Intento de fallback desde backend/local
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

            // ------------- Resolver template (robusto) y detectar isCombo -------------
            let tmpl = null;
            try {
                // 1) Si product.product_tmpl_id existe y ya es un objeto
                if (product && product.product_tmpl_id && typeof product.product_tmpl_id === "object" && !Array.isArray(product.product_tmpl_id)) {
                    tmpl = product.product_tmpl_id;
                }
                // 2) Si es array tipo [id, name]
                else if (product && Array.isArray(product.product_tmpl_id)) {
                    const tid = product.product_tmpl_id[0];
                    tmpl = this.pos.models["product.template"]?.get(tid);
                }
                // 3) Si es número (id)
                else if (product && typeof product.product_tmpl_id === "number") {
                    tmpl = this.pos.models["product.template"]?.get(product.product_tmpl_id);
                }
                // 4) Si el product YA es template (tiene combo_ids)
                else if (product && product.combo_ids) {
                    tmpl = product;
                } else {
                    // 5) Fallback: intentar resolver desde la variante obtenida en cache
                    const maybeVariant = this.pos.models["product.product"]?.get(variantId);
                    if (maybeVariant) {
                        // maybeVariant puede tener product_tmpl_id o puede contener directamente campos
                        if (maybeVariant.product_tmpl_id && typeof maybeVariant.product_tmpl_id === "object") {
                            tmpl = maybeVariant.product_tmpl_id;
                        } else if (maybeVariant.product_tmpl_id) {
                            tmpl = this.pos.models["product.template"]?.get(maybeVariant.product_tmpl_id);
                        }
                    }
                }
            } catch (e) {
                console.warn("Error resolviendo template:", e);
                tmpl = null;
            }

            const isCombo =
                !!tmpl &&
                (tmpl.isCombo === true ||
                    (typeof tmpl.isCombo === "function" && tmpl.isCombo()) ||
                    (Array.isArray(tmpl.combo_ids) && tmpl.combo_ids.length > 0) ||
                    (tmpl.combo_ids && typeof tmpl.combo_ids === "object" && Object.keys(tmpl.combo_ids).length > 0));

            if (isCombo) {
                // Es combo: no comprobamos stock aquí (se hará en el popup del combo)
                return await OriginalAdd.call(this, product);
            }

            // ------------- Detectar tipo de producto y saltar si NO es 'product' -------------
            // Queremos NO verificar stock para consumibles/servicios (type !== 'product'),
            // salvo que el producto tenga tracking por lote (entonces mostramos popup de lotes).
            let productType = null;
            try {
                // 1) Si el product directo trae 'type'
                if (product && product.type) {
                    productType = product.type;
                } else if (tmpl && tmpl.type) {
                    // template trae type
                    productType = tmpl.type;
                } else {
                    // intentar desde la variante cacheada
                    const maybeVariant = this.pos.models["product.product"]?.get(variantId);
                    if (maybeVariant && maybeVariant.type) {
                        productType = maybeVariant.type;
                    } else {
                        // Como última opción preguntar al backend por la variante
                        try {
                            const prodInfo = await this.pos.data.searchRead(
                                "product.product",
                                [["id", "=", variantId]],
                                ["type"],
                                { limit: 1 }
                            );
                            productType = (prodInfo && prodInfo.length) ? prodInfo[0].type : null;
                        } catch (e) {
                            console.warn("No se pudo leer product.type desde backend:", e);
                            productType = null;
                        }
                    }
                }
            } catch (e) {
                console.warn("Error resolviendo productType:", e);
                productType = null;
            }

            // Si el producto NO es almacenable ('product'), y NO es trackeado por lotes, saltamos la comprobación de stock
            const isLotTracked = (product && product.tracking === "lot") || (tmpl && tmpl.tracking === "lot");
            if (productType && productType !== "product" && !isLotTracked) {
                // No comprobar stock para consumables/servicios que no hacen inventario
                return await OriginalAdd.call(this, product);
            }

            // ------------- Obtener location_id (si está configurada) -------------
            const cfg = this.pos.config || {};
            const location_id =
                (cfg.ubicacion_id && cfg.ubicacion_id[0]) ||
                (cfg.stock_location_id && cfg.stock_location_id[0]) ||
                (cfg.stock_location && cfg.stock_location[0]);

            // ------------- Si es producto con tracking por lote -------------
            if (product && product.tracking === "lot") {
                // Consultamos stock.quant y abrimos popup de lotes (igual que antes)
                const domain = location_id
                    ? [["product_id", "=", variantId], ["location_id", "=", location_id]]
                    : [["product_id", "=", variantId]];

                let productLot = [];
                try {
                    productLot = await this.pos.data.searchRead(
                        "stock.quant",
                        domain,
                        ["lot_id", "quantity", "removal_date"],
                        { limit: 200 }
                    );
                } catch (e) {
                    console.error("Error leyendo stock.quant para lotes:", e);
                    return await OriginalAdd.call(this, product);
                }

                const lot_list = [];
                if (productLot && productLot.length) {
                    productLot.forEach(result => {
                        const qty = Number(result.quantity || 0);
                        if (qty > 0 && result.lot_id) {
                            const lotName = result.lot_id[1] || String(result.lot_id[0]);
                            const label = `Lote: ${lotName} Disponible: ${String(qty)} CAD: ${result.removal_date || ""}`;
                            lot_list.push({
                                id: result.lot_id[0],
                                label,
                                isSelected: false,
                                item: result,
                                lot_id: result.lot_id,
                            });
                        }
                    });
                }

                if (!lot_list.length) {
                    this.notification.add(
                        _t('No hay existencias disponibles para "%s".', product?.name || ""),
                        { type: "warning", title: _t("Sin stock") }
                    );
                    return;
                }

                const { confirmed, payload } = await this.showPopup('SelectionPopup', {
                    title: _t('Seleccione un Lote'),
                    list: lot_list,
                    confirmText: _t('Aceptar'),
                });

                if (confirmed && payload) {
                    const optionsProduct = {
                        description: false,
                        price_extra: 0,
                        draftPackLotLines: {
                            newPackLotLines: [
                                {
                                    lot_name: payload.lot_id ? payload.lot_id[1] : undefined,
                                    lot_id: payload.lot_id ? payload.lot_id[0] : undefined,
                                },
                            ],
                        },
                    };

                    try {
                        if (this.currentOrder && typeof this.currentOrder.add_product === "function") {
                            await this.currentOrder.add_product(product, optionsProduct);
                        } else if (this.pos && typeof this.pos.addLineToCurrentOrder === "function") {
                            await this.pos.addLineToCurrentOrder(product, optionsProduct);
                        } else {
                            await OriginalAdd.call(this, product);
                        }
                    } catch (e) {
                        console.error("Error añadiendo producto con lote:", e);
                        await OriginalAdd.call(this, product);
                    }
                }
                return;
            }

            // ------------- Si no es tracking por lote: comprobamos stock global -------------
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
                return await OriginalAdd.call(this, product);
            }

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