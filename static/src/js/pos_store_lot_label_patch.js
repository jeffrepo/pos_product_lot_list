/** pos_product_lot_list/static/src/js/pos_store_lot_label_patch.js */
import { patch } from "@web/core/utils/patch";
import { SelectLotPopup } from "@point_of_sale/app/components/popups/select_lot_popup/select_lot_popup";
import { makeAwaitable } from "@point_of_sale/app/utils/make_awaitable_dialog";
import { PosStore } from "@point_of_sale/app/services/pos_store";
import { _t } from "@web/core/l10n/translation";

patch(PosStore.prototype, {
    async editLots(product, packLotLinesToEdit) {
        // Copia grande del original pero con la parte de existingLots sustituida
        const isAllowOnlyOneLot = product.isAllowOnlyOneLot();
        let canCreateLots = this.pickingType.use_create_lots || !this.pickingType.use_existing_lots;

        // --- NUEVA PARTE: obtenemos lotes desde stock.quant para mostrar qty y removal_date ---
        let existingLots = [];
        try {
            // obtener location si está en config (soporte varios nombres)
            const cfg = this.config || {};
            const location_id =
                (cfg.ubicacion_id && cfg.ubicacion_id[0]) ||
                (cfg.stock_location_id && cfg.stock_location_id[0]) ||
                (cfg.stock_location && cfg.stock_location[0]);

            const domain = location_id
                ? [
                      ["product_id", "=", product.id],
                      ["location_id", "=", location_id],
                  ]
                : [["product_id", "=", product.id]];

            // leemos los quants; pedimos lot_id, quantity y removal_date
            const quants = await this.data.searchRead(
                "stock.quant",
                domain,
                ["lot_id", "quantity", "removal_date"],
                { limit: 200 }
            );

            const lotIds = [...new Set(
                (quants || [])
                    .map((q) => q.lot_id)
                    .filter((id) => !!id)
            )];

            let lotsById = {};
            if (lotIds.length) {
                const lots = await this.data.searchRead(
                    "stock.lot",
                    [["id", "in", lotIds]],
                    ["id", "name"]
                );
                lotsById = Object.fromEntries((lots || []).map((l) => [l.id, l.name]));
            }


            // Mapear a la forma que espera SelectLotPopup / el resto del código.
            // Creamos 'name' con Lote + Cantidad + Caducidad para que el popup lo muestre.
            existingLots = (quants || [])
                .filter((q) => q.lot_id && Number(q.quantity || 0) > 0)
                .map((q) => {
                    const lotId = q.lot_id;
                    const lotName = lotsById[lotId] || "";
                    const qty = Number(q.quantity || 0);
                    const removal = q.removal_date || "";
                    const formattedName = `Lote: ${lotName} - Disponible: ${qty}${removal ? " - CAD: " + removal : ""}`;
            
                    return {
                        id: lotId,
                        lot_id: lotId,
                        name: formattedName,
                        product_qty: qty,
                        quantity: qty,
                        removal_date: removal,
                    };
                });
        } catch (ex) {
            // Si falla la consulta directa, intentamos el camino original (backend)
            console.error("pos_product_lot_list: error leyendo stock.quant, fallback al backend:", ex);
            try {
                existingLots = await this.data.call("pos.order.line", "get_existing_lots", [
                    this.company.id,
                    this.config.id,
                    product.id,
                ]);
            } catch (ex2) {
                console.error("pos_product_lot_list: fallback también falló:", ex2);
                this.dialog.add({
                    title: _t("Error"),
                    body: _t("No se pudieron recuperar los lotes desde el servidor."),
                });
                return null;
            }
        }

        // --- Resto del código original (adaptado) ---
        if (!canCreateLots && (!existingLots || existingLots.length === 0)) {
            this.dialog.add({
                title: _t("No existing serial/lot number"),
                body: _t(
                    "There is no serial/lot number for the selected product, and their creation is not allowed from the Point of Sale app."
                ),
            });
            return null;
        }

        // Calcular lotes ya usados en órdenes en borrador
        const usedLotsQty = this.models["pos.pack.operation.lot"]
            .filter(
                (lot) =>
                    lot.pos_order_line_id?.product_id?.id === product.id &&
                    lot.pos_order_line_id?.order_id?.state === "draft"
            )
            .reduce((acc, lot) => {
                if (!acc[lot.lot_name]) {
                    acc[lot.lot_name] = { total: 0, currentOrderCount: 0 };
                }
                acc[lot.lot_name].total += lot.pos_order_line_id?.qty || 0;

                if (lot.pos_order_line_id?.order_id?.id === this.selectedOrder.id) {
                    acc[lot.lot_name].currentOrderCount += lot.pos_order_line_id?.qty || 0;
                }
                return acc;
            }, {});

        // Remove lot/serial names that are already used in draft orders
        existingLots = existingLots.filter(
            (lot) => lot.product_qty > (usedLotsQty[lot.name]?.total || 0)
        );

        // Check if the input lot/serial name is already used in another order
        const isLotNameUsed = (itemValue) => {
            const totalQty = existingLots.find((lt) => lt.name == itemValue)?.product_qty || 0;
            const usedQty = usedLotsQty[itemValue]
                ? usedLotsQty[itemValue].total - usedLotsQty[itemValue].currentOrderCount
                : 0;
            return usedQty ? usedQty >= totalQty : false;
        };

        const existingLotsName = existingLots.map((l) => l.name);
        if (!packLotLinesToEdit.length && existingLotsName.length === 1) {
            // If there's only one existing lot/serial number, automatically assign it to the order line
            return { newPackLotLines: [{ lot_name: existingLotsName[0] }] };
        }

        // Llamamos al popup con las opciones preparadas — el name ya contiene la fecha y la cantidad
        const payload = await makeAwaitable(this.dialog, SelectLotPopup, {
            title: _t("Lot/Serial number(s) required for"),
            name: product.display_name,
            isSingleItem: isAllowOnlyOneLot,
            array: packLotLinesToEdit,
            options: existingLots,
            customInput: canCreateLots,
            uniqueValues: product.tracking === "serial",
            isLotNameUsed: isLotNameUsed,
        });

        if (payload) {
            // Segregate the old and new packlot lines (idéntico a original)
            const modifiedPackLotLines = Object.fromEntries(
                payload.filter((item) => item.id).map((item) => [item.id, item.text])
            );
            const newPackLotLines = payload
                .filter((item) => !item.id)
                .map((item) => ({ lot_name: item.text }));

            return { modifiedPackLotLines, newPackLotLines };
        } else {
            return null;
        }
    },
});