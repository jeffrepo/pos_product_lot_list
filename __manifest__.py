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

    ],

    'assets':{
        'point_of_sale.assets': [
            'pos_product_lot_list/static/src/js/Screens/ProductScreen/ProductScreen.js',
        ],
    },
    'license': 'LGPL-3',
}
