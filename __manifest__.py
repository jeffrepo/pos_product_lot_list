# -*- coding: utf-8 -*-
{
    'name': "Pos product lot list",

    'summary': """ Pos product lot list""",

    'description': """
        Muestra los lotes disponibles al seleccionar un producto
    """,

    'author': "JS",
    'website': "",

    'category': 'Uncategorized',
    'version': '1.01',

    'depends': ['point_of_sale'],

    'data': [
        'views/pos_config_view.xml',
    ],

    'assets': {
        'point_of_sale._assets_pos': [
            'pos_product_lot_list/static/src/js/Screens/ProductScreen/stock_check_patch.js',
            'pos_product_lot_list/static/src/js/pos_store_lot_label_patch.js',
            'pos_product_lot_list/static/src/js/popups/combo_configurator_popup_stock_check_patch.js',
        ],
    },
    'license': 'LGPL-3',
}
