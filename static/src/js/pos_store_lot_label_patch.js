/** pos_product_lot_list/static/src/js/pos_store_lot_label_patch.js */
import { patch } from "@web/core/utils/patch";
import { SelectLotPopup } from "@point_of_sale/app/components/popups/select_lot_popup/select_lot_popup";
import { makeAwaitable } from "@point_of_sale/app/utils/make_awaitable_dialog";
import { PosStore } from "@point_of_sale/app/services/pos_store";
import { _t } from "@web/core/l10n/translation";

function normalizeId(value) {
    if (!value && value !== 0) return undefined;
    if (Array.isArray(value)) return value[0];
    if (typeof value === "object" && value.id) return value.id;
    if (typeof value === "number") return value;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

patch(PosStore.prototype, {
    async editLots(product, packLotLinesToEdit) {
        const isAllowOnlyOneLot = product.isAllowOnlyOneLot();
        let canCreateLots = this.pickingType.use_create_lots || !this.pickingType.use_existing_lots;

        let existingLots = [];
        // <-- Declarar usedLotsQty aquí para que esté disponible fuera del try
        let usedLotsQty = {};

        try {
            // ------------------ RESOLVER LOCATION_ID ROBUSTAMENTE ------------------
            const cfg = this.config || {};
            const candidates = [];

            candidates.push(
                cfg.ubicacion_id,
                cfg.stock_location_id,
                cfg.stock_location,
                cfg.location_id,
                cfg.default_location_src_id,
                cfg.default_location_dest_id
            );

            if (this.pickingType) {
                candidates.push(
                    this.pickingType.default_location_src_id,
                    this.pickingType.default_location_dest_id,
                    this.pickingType.default_location_id
                );
            }

            try {
                if (this.selectedOrder) {
                    const so = this.selectedOrder;
                    if (typeof so.get === "function") {
                        candidates.push(so.get("location_id"));
                        candidates.push(so.get("picking_type_id"));
                    } else {
                        candidates.push(so.location_id, so.picking_type_id);
                    }
                }
            } catch (e) {
                console.warn("pos_store_lot_label_patch: error probing selectedOrder for location", e);
            }

            candidates.push(
                this.location_id,
                this.default_location_id,
                this.stock_location_id,
            );

            let location_id;
            for (const c of candidates) {
                const id = normalizeId(c);
                if (id) {
                    location_id = id;
                    break;
                }
            }

            console.log("DEBUG pos_store_lot_label_patch: cfg keys:", Object.keys(cfg || {}));
            console.log("DEBUG pos_store_lot_label_patch: location candidates sample:", candidates.slice(0, 10));
            console.log("DEBUG pos_store_lot_label_patch: resolved location_id:", location_id);

            // ------------------ PREPARAR DOMAIN ------------------
            const domainBase = [
                ["product_id", "=", product.id],
                ["quantity", ">", 0],
                ["lot_id", "!=", false],
            ];
            const domain = location_id
                ? [["product_id", "=", product.id], ["location_id", "=", location_id], ["quantity", ">", 0], ["lot_id", "!=", false]]
                : domainBase.slice();

            if (this.company && this.company.id) {
                domain.push(["company_id", "=", this.company.id]);
            }

            console.log("DEBUG pos_store_lot_label_patch: domain used for stock.quant:", domain);

            // ------------------ LEER QUANTS FILTRADOS Y AGRUPAR EN CLIENTE ------------------
            let quants = [];
            try {
                quants = await this.data.searchRead(
                    "stock.quant",
                    domain,
                    ["lot_id", "quantity", "removal_date"],
                    { limit: 2000, order: "lot_id" }
                );
            } catch (e) {
                console.warn("pos_store_lot_label_patch: searchRead stock.quant falló:", e);
                quants = [];
            }

            console.log("DEBUG pos_store_lot_label_patch: quants length (raw):", quants.length);

            const lotSums = quants.reduce((acc, q) => {
                const lotId = normalizeId(q.lot_id);
                if (!lotId) return acc;
                const qty = Number(q.quantity || 0);
                if (qty <= 0) return acc;
                if (!acc[lotId]) acc[lotId] = { quantity: 0, removal_dates: [] };
                acc[lotId].quantity += qty;
                if (q.removal_date) acc[lotId].removal_dates.push(q.removal_date);
                return acc;
            }, {});

            const lotIds = Object.keys(lotSums).map(k => Number(k)).filter(Boolean);
            console.log("DEBUG pos_store_lot_label_patch: lotIds after grouping:", lotIds.length, lotIds.slice(0, 20));

            // ------------------ OBTENER NOMBRES DE LOTES ------------------
            let lotsById = {};
            if (lotIds.length) {
                try {
                    const lots = await this.data.searchRead("stock.lot", [["id", "in", lotIds]], ["id", "name"], { limit: 2000 });
                    lotsById = Object.fromEntries((lots || []).map(l => [l.id, l.name]));
                } catch (e) {
                    console.warn("pos_store_lot_label_patch: searchRead stock.lot falló:", e);
                    lotsById = {};
                }
            }

            // ------------------ OBTENER REMOVAL_DATE MÍNIMA POR LOTE ------------------
            const removalsByLot = {};
            lotIds.forEach(lid => {
                const arr = (lotSums[lid] && lotSums[lid].removal_dates) || [];
                if (arr.length) {
                    arr.sort();
                    removalsByLot[lid] = arr[0];
                }
            });

            // ------------------ RESTAR LOTES USADOS POR ORDENES DRAFT ------------------
            // Asignamos a la variable ya declarada arriba para que esté disponible fuera del try
            usedLotsQty = this.models["pos.pack.operation.lot"]
                .filter(
                    (lot) =>
                        lot.pos_order_line_id?.product_id?.id === product.id &&
                        lot.pos_order_line_id?.order_id?.state === "draft"
                )
                .reduce((acc, lot) => {
                    const lotName = lot.lot_name;
                    if (!acc[lotName]) acc[lotName] = { total: 0, currentOrderCount: 0 };
                    acc[lotName].total += lot.pos_order_line_id?.qty || 0;
                    if (lot.pos_order_line_id?.order_id?.id === this.selectedOrder.id) {
                        acc[lotName].currentOrderCount += lot.pos_order_line_id?.qty || 0;
                    }
                    return acc;
                }, {});

            // ------------------ CONSTRUIR existingLots ------------------
            existingLots = lotIds.map(lid => {
                const info = lotSums[lid] || { quantity: 0 };
                const lotName = lotsById[lid] || String(lid);
                const usedEntry = usedLotsQty[lotName];
                const usedTotal = usedEntry ? usedEntry.total : 0;
                const currentOrderCount = usedEntry ? usedEntry.currentOrderCount : 0;
                const available = Number(info.quantity || 0) - (usedTotal - currentOrderCount || 0);
                return {
                    id: lid,
                    lot_id: lid,
                    lot_name: lotName,
                    name: `Lote: ${lotName} - Disponible: ${available}${removalsByLot[lid] ? " - CAD: " + removalsByLot[lid] : ""}`,
                    product_qty: available,
                    quantity: available,
                    removal_date: removalsByLot[lid] || "",
                    _raw_total: Number(info.quantity || 0),
                    _used_total: usedTotal,
                    _used_current_order: currentOrderCount,
                };
            }).filter(l => l.product_qty > 0);

            console.log("DEBUG pos_store_lot_label_patch: final existingLots length:", existingLots.length);

        } catch (ex) {
            console.error("pos_product_lot_list: error leyendo quants agrupados, fallback al backend:", ex);
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

        // --- Resto del flujo original ---
        if (!canCreateLots && (!existingLots || existingLots.length === 0)) {
            this.dialog.add({
                title: _t("No existing serial/lot number"),
                body: _t(
                    "There is no serial/lot number for the selected product, and their creation is not allowed from the Point of Sale app."
                ),
            });
            return null;
        }

        const existingLotsName = (existingLots || []).map((l) => l.name || l.lot_name || String(l.id));
        if (!packLotLinesToEdit.length && existingLotsName.length === 1) {
            return { newPackLotLines: [{ lot_name: existingLotsName[0] }] };
        }

        const isLotNameUsed = (itemValue) => {
            const totalQty = (existingLots.find((lt) => lt.name == itemValue) || {}).product_qty || 0;
            const used = usedLotsQty[itemValue] ? usedLotsQty[itemValue].total - usedLotsQty[itemValue].currentOrderCount : 0;
            return used ? used >= totalQty : false;
        };

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