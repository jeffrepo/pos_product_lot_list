# -*- coding: utf-8 -*-

import re
from odoo import api, fields, models, _
import logging
from odoo.exceptions import UserError, ValidationError

_logger = logging.getLogger(__name__)


class StockMove(models.Model):
    _inherit = "stock.move"

    def _clean_pos_lot_name(self, lot_name):
        """
        Convierte:
        'Lote: 0019340 - Disponible: 1000 - CAD: ...'
        en:
        '0019340'
        """
        if not lot_name:
            return lot_name

        match = re.search(r"Lote:\s*([^-]+)", lot_name)
        if match:
            return match.group(1).strip()

        return lot_name.strip()

    def _create_production_lots_for_pos_order(self, lines):
        for line in lines:
            for pack_lot in line.pack_lot_ids:
                pack_lot.lot_name = self._clean_pos_lot_name(pack_lot.lot_name)

        return super()._create_production_lots_for_pos_order(lines)



class StockPicking(models.Model):
    _inherit = "stock.picking"


class StockPicking(models.Model):
    _inherit = "stock.picking"


    def _create_move_from_pos_order_lines(self, lines):
        res = super()._create_move_from_pos_order_lines(lines)

        self.move_ids.picked = True
        self.move_line_ids.picked = True

        return res
