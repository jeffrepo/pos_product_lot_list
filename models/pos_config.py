# -*- encoding: utf-8 -*-

from odoo import models, fields, api, _

class PosConfig(models.Model):
    _inherit = 'pos.config'

    ubicacion_id = fields.Many2one('stock.location', 'Ubicaciíon',store=True, related='picking_type_id.default_location_src_id' )