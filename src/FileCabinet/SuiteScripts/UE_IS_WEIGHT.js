/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log'], (record, log) => {
    const INBOUND_TYPE = 'inboundshipment';
    const PO_TYPE = 'purchaseorder';

    const SUBLIST_ITEMS = 'items';

    const FLD_IS_PURCHASE_ORDER = 'purchaseorder';
    const FLD_IS_PO_LINE_UNIQUE_KEY = 'shipmentitem';
    const FLD_IS_QTY_EXPECTED = 'quantityexpected';

    const PO_SUBLIST_ITEM = 'item';
    const FLD_PO_LINE_UNIQUE_KEY = 'lineuniquekey';
    const FLD_PO_WEIGHT_CUBE = 'custcol_weight_cube';

    const FLD_IS_LINE_WEIGHT_CUBE = 'custrecord_is_weight_cube';
    const FLD_IS_LINE_TOTAL_WEIGHT_CUBE = 'custrecord_is_line_total_weight_cube';
    const FLD_IS_BODY_TOTAL_WEIGHT_CUBE = 'custrecord_is_total_weight_cube';

    function afterSubmit(context) {
        if (
            context.type !== context.UserEventType.CREATE &&
            context.type !== context.UserEventType.EDIT
        ) {
            return;
        }

        const inboundId = context.newRecord.id;

        try {
            const inboundRec = record.load({
                type: INBOUND_TYPE,
                id: inboundId,
                isDynamic: false
            });

            const lineCount = inboundRec.getLineCount({
                sublistId: SUBLIST_ITEMS
            });

            const poCache = {};
            let shipmentTotal = 0;
            let changed = false;

            for (let i = 0; i < lineCount; i++) {
                const poId = inboundRec.getSublistValue({
                    sublistId: SUBLIST_ITEMS,
                    fieldId: FLD_IS_PURCHASE_ORDER,
                    line: i
                });

                const poLineUniqueKey = inboundRec.getSublistValue({
                    sublistId: SUBLIST_ITEMS,
                    fieldId: FLD_IS_PO_LINE_UNIQUE_KEY,
                    line: i
                });

                const qtyExpected = toNumber(inboundRec.getSublistValue({
                    sublistId: SUBLIST_ITEMS,
                    fieldId: FLD_IS_QTY_EXPECTED,
                    line: i
                }));

                if (!poId || !poLineUniqueKey) {
                    continue;
                }

                if (!poCache[poId]) {
                    poCache[poId] = buildPoLineMap(poId);
                }

                const poLineData = poCache[poId][String(poLineUniqueKey)];

                if (!poLineData) {
                    log.debug('PO line not found', {
                        inboundId,
                        inboundLine: i,
                        poId,
                        poLineUniqueKey
                    });
                    continue;
                }

                const unitWeightCube = toNumber(poLineData.weightCube);
                const lineTotalWeightCube = round(qtyExpected * unitWeightCube, 5);

                shipmentTotal += lineTotalWeightCube;

                inboundRec.setSublistValue({
                    sublistId: SUBLIST_ITEMS,
                    fieldId: FLD_IS_LINE_WEIGHT_CUBE,
                    line: i,
                    value: unitWeightCube
                });

                inboundRec.setSublistValue({
                    sublistId: SUBLIST_ITEMS,
                    fieldId: FLD_IS_LINE_TOTAL_WEIGHT_CUBE,
                    line: i,
                    value: lineTotalWeightCube
                });

                changed = true;
            }

            shipmentTotal = round(shipmentTotal, 5);

            inboundRec.setValue({
                fieldId: FLD_IS_BODY_TOTAL_WEIGHT_CUBE,
                value: shipmentTotal
            });

            changed = true;

            if (changed) {
                inboundRec.save({
                    enableSourcing: false,
                    ignoreMandatoryFields: true
                });
            }

        } catch (e) {
            log.error('Error calculating inbound shipment weight cube', e);
            throw e;
        }
    }

    function buildPoLineMap(poId) {
        const poRec = record.load({
            type: PO_TYPE,
            id: poId,
            isDynamic: false
        });

        const lineCount = poRec.getLineCount({
            sublistId: PO_SUBLIST_ITEM
        });

        const lineMap = {};

        for (let i = 0; i < lineCount; i++) {
            const lineUniqueKey = poRec.getSublistValue({
                sublistId: PO_SUBLIST_ITEM,
                fieldId: FLD_PO_LINE_UNIQUE_KEY,
                line: i
            });

            if (!lineUniqueKey) {
                continue;
            }

            lineMap[String(lineUniqueKey)] = {
                weightCube: poRec.getSublistValue({
                    sublistId: PO_SUBLIST_ITEM,
                    fieldId: FLD_PO_WEIGHT_CUBE,
                    line: i
                })
            };
        }

        return lineMap;
    }

    function toNumber(value) {
        const num = parseFloat(value);
        return isNaN(num) ? 0 : num;
    }

    function round(value, decimals) {
        const factor = Math.pow(10, decimals || 2);
        return Math.round((value + Number.EPSILON) * factor) / factor;
    }

    return {
        afterSubmit
    };
});