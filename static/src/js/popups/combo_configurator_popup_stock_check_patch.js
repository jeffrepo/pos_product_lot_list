/** pos_product_lot_list/static/src/js/popups/combo_configurator_popup_stock_check_patch.js */
import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { ComboConfiguratorPopup } from "@point_of_sale/app/components/popups/combo_configurator_popup/combo_configurator_popup";

patch(ComboConfiguratorPopup.prototype, {
    async confirm() {
        try {
            const [itemsIncluded, itemsExtra] = this.getSelectedComboItems();
            const allItems = [...itemsIncluded, ...itemsExtra];

            // Construir requerimiento por product_id
            const required = {};
            for (const it of allItems) {
                const pid = it.combo_item_id.product_id.id;
                required[pid] = (required[pid] || 0) + (it.qty || 0);
            }

            const pids = Object.keys(required).map((id) => Number(id));
            if (pids.length > 0) {
                // Leer qty_available de las variantes involucradas
                const prodInfos = await this.pos.data.searchRead(
                    "product.product",
                    [["id", "in", pids]],
                    ["qty_available"]
                );
                const stockMap = {};
                prodInfos.forEach((p) => {
                    stockMap[p.id] = Number(p.qty_available || 0);
                });

                // Buscar faltantes
                const shortages = [];
                for (const pid of pids) {
                    const need = required[pid];
                    const ava = stockMap[pid] || 0;
                    if (ava < need) {
                        const productObj = this.pos.models["product.product"].get(pid);
                        const name = productObj?.display_name || `ID ${pid}`;
                        shortages.push({ name, need, ava });
                    }
                }

                if (shortages.length > 0) {
                    // Construir mensaje y mostrar alerta
                    const body = shortages
                        .map((s) => `${s.name}: requiere ${s.need}, disponible ${s.ava}`)
                        .join("<br/>");
                    await this.env.services.dialog.add(AlertDialog, {
                        title: _t("Sin stock en componentes del combo"),
                        body,
                    });
                    // No confirmar (bloqueamos la adición del combo)
                    return;
                }
            }

            // Si todo OK, confirmar la selección
            this.props.getPayload(this.getSelectedComboItems());
            this.props.close();
        } catch (err) {
            console.error("Error comprobando stock en ComboConfiguratorPopup.confirm:", err);
            // Fallback: confirmar para no bloquear UX por un error inesperado
            this.props.getPayload(this.getSelectedComboItems());
            this.props.close();
        }
    },
});