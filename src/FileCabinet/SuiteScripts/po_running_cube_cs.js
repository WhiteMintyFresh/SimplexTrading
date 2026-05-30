/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {
    const ITEM_SUBLIST = 'item';

    // Line field: per-unit cube / weight
    const LINE_CUBE_FIELD = 'custcol_weight_cube';

    // Line field: total weight / cube for that item line
    const LINE_TOTAL_WEIGHT_FIELD = 'custcol_total_weight';

    // Body field: grand total of all line total weights / cubes
    const BODY_TOTAL_WEIGHT_FIELD = 'custbody_total_weight_cube';

    function toNumber(value) {
        const num = parseFloat(value);
        return isNaN(num) ? 0 : num;
    }

    function round2(value) {
        return Math.round((value + Number.EPSILON) * 100) / 100;
    }

    function getCurrentLineIndex(currentRecord) {
        try {
            return currentRecord.getCurrentSublistIndex({
                sublistId: ITEM_SUBLIST
            });
        } catch (e) {
            return -1;
        }
    }

    function hasCurrentLineData(currentRecord) {
        try {
            const item = currentRecord.getCurrentSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId: 'item'
            });

            const quantity = currentRecord.getCurrentSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId: 'quantity'
            });

            const cube = currentRecord.getCurrentSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId: LINE_CUBE_FIELD
            });

            const total = currentRecord.getCurrentSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId: LINE_TOTAL_WEIGHT_FIELD
            });

            return !!item || !!quantity || !!cube || !!total;
        } catch (e) {
            return false;
        }
    }

    function calculateCurrentLineTotal(currentRecord) {
        const quantity = toNumber(
            currentRecord.getCurrentSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId: 'quantity'
            })
        );

        const cubePerUnit = toNumber(
            currentRecord.getCurrentSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId: LINE_CUBE_FIELD
            })
        );

        const totalWeightCube = round2(quantity * cubePerUnit);

        currentRecord.setCurrentSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: LINE_TOTAL_WEIGHT_FIELD,
            value: totalWeightCube,
            ignoreFieldChange: true
        });

        return totalWeightCube;
    }

    function updateHeaderTotalWeight(currentRecord) {
        let grandTotal = 0;

        const lineCount = currentRecord.getLineCount({
            sublistId: ITEM_SUBLIST
        });

        const currentLineIndex = getCurrentLineIndex(currentRecord);

        // Sum committed lines
        for (let i = 0; i < lineCount; i++) {
            // If user is editing an existing line, skip the committed version
            // and use the current-line value instead.
            if (i === currentLineIndex) {
                continue;
            }

            const lineTotal = currentRecord.getSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId: LINE_TOTAL_WEIGHT_FIELD,
                line: i
            });

            grandTotal += toNumber(lineTotal);
        }

        // Add current active line, if user is currently editing/adding a line
        if (hasCurrentLineData(currentRecord)) {
            const currentLineTotal = currentRecord.getCurrentSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId: LINE_TOTAL_WEIGHT_FIELD
            });

            grandTotal += toNumber(currentLineTotal);
        }

        currentRecord.setValue({
            fieldId: BODY_TOTAL_WEIGHT_FIELD,
            value: round2(grandTotal),
            ignoreFieldChange: true
        });
    }

    function recalculateAll(context) {
        const currentRecord = context.currentRecord;

        try {
            calculateCurrentLineTotal(currentRecord);
        } catch (e) {
            // Ignore if there is no active item line.
        }

        updateHeaderTotalWeight(currentRecord);
    }

    function pageInit(context) {
        updateHeaderTotalWeight(context.currentRecord);
    }

    function fieldChanged(context) {
        if (context.sublistId !== ITEM_SUBLIST) {
            return;
        }

        if (
            context.fieldId === 'quantity' ||
            context.fieldId === LINE_CUBE_FIELD ||
            context.fieldId === LINE_TOTAL_WEIGHT_FIELD
        ) {
            recalculateAll(context);
        }
    }

    function postSourcing(context) {
        if (context.sublistId !== ITEM_SUBLIST) {
            return;
        }

        if (
            context.fieldId === 'item' ||
            context.fieldId === 'quantity' ||
            context.fieldId === LINE_CUBE_FIELD
        ) {
            recalculateAll(context);
        }
    }

    function validateLine(context) {
        if (context.sublistId === ITEM_SUBLIST) {
            recalculateAll(context);
        }

        return true;
    }

    function sublistChanged(context) {
        if (context.sublistId === ITEM_SUBLIST) {
            updateHeaderTotalWeight(context.currentRecord);
        }
    }

    function saveRecord(context) {
        updateHeaderTotalWeight(context.currentRecord);
        return true;
    }

    return {
        pageInit,
        fieldChanged,
        postSourcing,
        validateLine,
        sublistChanged,
        saveRecord
    };
});