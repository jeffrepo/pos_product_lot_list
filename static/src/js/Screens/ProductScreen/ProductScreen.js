odoo.define('pos_product_lot_list.ProductScreen', function(require) {
    'use strict';

    const Registries = require('point_of_sale.Registries');
    const ProductScreen = require('point_of_sale.ProductScreen');
    var { Gui } = require('point_of_sale.Gui');
    const NumberBuffer = require('point_of_sale.NumberBuffer');
    var core = require('web.core');
    var _t = core._t;


    const PosProductLotListProductScreen = ProductScreen =>
        class extends ProductScreen {
            constructor(obj, options) {
                super(...arguments);
            }

            async _clickProduct(event) {
                const productSelected = event.detail;
                var productLot = [];
                var location_id = this.env.pos.config.ubicacion_id[0];
                var lot_list = []
                var optionsProduct = await this._getAddProductOptions(productSelected);
                if (productSelected.tracking == "lot"){
                    productLot = await this.rpc({
                        model: 'stock.quant',
                        method: 'search_read',
                        args: [[
                            ['product_id', '=', productSelected.id],
                            ['location_id', '=', location_id]
                        ]],
                        context: this.env.session.user_context,
                    });                    
                    if (productLot.length > 0){
                        productLot.forEach(result => {

                            lot_list.push({'id': result.lot_id[0],'label': 'Lote: ' + result.lot_id[1] + ' Disponible: ' + result.quantity.toString()  + ' CAD: ' + result.removal_date.toString(), isSelected: false, item: result})
                        });
                        
                        const { confirmed, payload } = await this.showPopup('SelectionPopup', {
                            title: this.env._t('Seleccione un Lote'),
                            list: lot_list,
                            confirmText: this.env._t('Aceptar'),
                        });
                        if (confirmed) {
                            var optionsProduct = {'descrption': false, 'draftPackLotLines': {'newPackLotLines': [{'lot_name': payload.lot_id[1]}]},'pirce_extra':0 }
                            await this.currentOrder.add_product(productSelected, optionsProduct);
                            NumberBuffer.reset();
                        }
                        
                        
                    }else{
                        return
                    }
                    
                }else{
                    var actionClickProduct = super._clickProduct(...arguments);
                    return actionClickProduct
                }

            }



        };

    Registries.Component.extend(ProductScreen, PosProductLotListProductScreen);


});
