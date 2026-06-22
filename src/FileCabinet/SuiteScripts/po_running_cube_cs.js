/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {
    const ITEM_SUBLIST = 'item';

    // Per-unit cube / weight
    const LINE_CUBE_FIELD = 'custcol_weight_cube';

    // Quantity × cube
    const LINE_TOTAL_WEIGHT_FIELD = 'custcol_total_weight';

    // Sum of all line totals
    const BODY_TOTAL_WEIGHT_FIELD = 'custbody_total_weight_cube';

    let isInitializing = true;
    let pageMode = '';

    function toNumber(value) {
        const number = parseFloat(value);
        return Number.isFinite(number) ? number : 0;
    }

    function hasNumericValue(value) {
        return (
            value !== null &&
            value !== '' &&
            value !== undefined &&
            Number.isFinite(parseFloat(value))
        );
    }

    function round2(value) {
        return Math.round((value + Number.EPSILON) * 100) / 100;
    }

    function hasActiveItemLine(currentRecord) {
        try {
            const itemId = currentRecord.getCurrentSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId: 'item'
            });

            return Boolean(itemId);
        } catch (error) {
            return false;
        }
    }

    function getActiveLineIndex(currentRecord) {
        if (!hasActiveItemLine(currentRecord)) {
            return -1;
        }

        try {
            return currentRecord.getCurrentSublistIndex({
                sublistId: ITEM_SUBLIST
            });
        } catch (error) {
            return -1;
        }
    }

    /**
     * Calculates and writes the current active item line.
     *
     * Important:
     * Do not overwrite an existing saved value when quantity or cube
     * has not finished sourcing.
     */
    function calculateCurrentLineTotal(currentRecord) {
        if (!hasActiveItemLine(currentRecord)) {
            return null;
        }

        const quantityRaw = currentRecord.getCurrentSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: 'quantity'
        });

        const cubeRaw = currentRecord.getCurrentSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: LINE_CUBE_FIELD
        });

        // Do not clear an existing line while NetSuite is sourcing fields.
        if (
            !hasNumericValue(quantityRaw) ||
            !hasNumericValue(cubeRaw)
        ) {
            return null;
        }

        const quantity = toNumber(quantityRaw);
        const cubePerUnit = toNumber(cubeRaw);
        const lineTotal = round2(quantity * cubePerUnit);

        currentRecord.setCurrentSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: LINE_TOTAL_WEIGHT_FIELD,
            value: lineTotal,
            ignoreFieldChange: true
        });

        return lineTotal;
    }

    /**
     * Gets the total for a committed line.
     *
     * Uses the saved line-total value first. If it is blank, calculates
     * quantity × cube without modifying the committed line.
     */
    function getCommittedLineTotal(currentRecord, line) {
        const savedLineTotal = currentRecord.getSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: LINE_TOTAL_WEIGHT_FIELD,
            line
        });

        if (hasNumericValue(savedLineTotal)) {
            return toNumber(savedLineTotal);
        }

        const quantity = currentRecord.getSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: 'quantity',
            line
        });

        const cubePerUnit = currentRecord.getSublistValue({
            sublistId: ITEM_SUBLIST,
            fieldId: LINE_CUBE_FIELD,
            line
        });

        if (
            !hasNumericValue(quantity) ||
            !hasNumericValue(cubePerUnit)
        ) {
            return 0;
        }

        return round2(
            toNumber(quantity) * toNumber(cubePerUnit)
        );
    }

    function updateHeaderTotalWeight(currentRecord, includeActiveLine) {
        let grandTotal = 0;

        const lineCount = currentRecord.getLineCount({
            sublistId: ITEM_SUBLIST
        });

        const activeLineExists =
            includeActiveLine && hasActiveItemLine(currentRecord);

        const activeLineIndex = activeLineExists
            ? getActiveLineIndex(currentRecord)
            : -1;

        for (let line = 0; line < lineCount; line++) {
            /*
             * When editing an existing line, skip its committed value.
             * The active edited value is added afterward.
             */
            if (
                activeLineExists &&
                activeLineIndex >= 0 &&
                line === activeLineIndex
            ) {
                continue;
            }

            grandTotal += getCommittedLineTotal(
                currentRecord,
                line
            );
        }

        if (activeLineExists) {
            const activeLineTotal =
                currentRecord.getCurrentSublistValue({
                    sublistId: ITEM_SUBLIST,
                    fieldId: LINE_TOTAL_WEIGHT_FIELD
                });

            if (hasNumericValue(activeLineTotal)) {
                grandTotal += toNumber(activeLineTotal);
            } else {
                /*
                 * If the line total has not yet been populated,
                 * calculate it without writing zero to the line.
                 */
                const quantity =
                    currentRecord.getCurrentSublistValue({
                        sublistId: ITEM_SUBLIST,
                        fieldId: 'quantity'
                    });

                const cubePerUnit =
                    currentRecord.getCurrentSublistValue({
                        sublistId: ITEM_SUBLIST,
                        fieldId: LINE_CUBE_FIELD
                    });

                if (
                    hasNumericValue(quantity) &&
                    hasNumericValue(cubePerUnit)
                ) {
                    grandTotal += round2(
                        toNumber(quantity) *
                        toNumber(cubePerUnit)
                    );
                }
            }
        }

        currentRecord.setValue({
            fieldId: BODY_TOTAL_WEIGHT_FIELD,
            value: round2(grandTotal),
            ignoreFieldChange: true
        });
    }

    function recalculateCurrentLineAndHeader(currentRecord) {
        calculateCurrentLineTotal(currentRecord);

        updateHeaderTotalWeight(
            currentRecord,
            true
        );
    }

    function pageInit(context) {
        pageMode = context.mode;
        isInitializing = true;

        /*
         * Do not write to any item lines during page initialization.
         *
         * For an existing PO, allow NetSuite to finish loading and
         * sourcing all committed item-line values.
         */
        window.setTimeout(() => {
            isInitializing = false;

            /*
             * Sum committed lines only. Do not treat NetSuite's current
             * line buffer as an actively edited line during page load.
             */
            updateHeaderTotalWeight(
                context.currentRecord,
                false
            );
        }, 1500);
    }

    function fieldChanged(context) {
        if (
            isInitializing ||
            context.sublistId !== ITEM_SUBLIST
        ) {
            return;
        }

        if (
            context.fieldId === 'quantity' ||
            context.fieldId === LINE_CUBE_FIELD
        ) {
            recalculateCurrentLineAndHeader(
                context.currentRecord
            );
        }
    }

    function postSourcing(context) {
        if (
            isInitializing ||
            context.sublistId !== ITEM_SUBLIST
        ) {
            return;
        }

        /*
         * When the user selects a new item, wait briefly for custom
         * column sourcing to complete before calculating the line.
         */
        if (context.fieldId === 'item') {
            window.setTimeout(() => {
                recalculateCurrentLineAndHeader(
                    context.currentRecord
                );
            }, 250);
        }
    }

    function validateLine(context) {
        if (context.sublistId !== ITEM_SUBLIST) {
            return true;
        }

        calculateCurrentLineTotal(
            context.currentRecord
        );

        /*
         * The line has not yet been committed during validateLine,
         * so include the active line.
         */
        updateHeaderTotalWeight(
            context.currentRecord,
            true
        );

        return true;
    }

    function sublistChanged(context) {
        if (context.sublistId !== ITEM_SUBLIST) {
            return;
        }

        /*
         * After Add, Edit, Insert, or Remove, use committed lines only.
         */
        updateHeaderTotalWeight(
            context.currentRecord,
            false
        );
    }

    function saveRecord(context) {
        /*
         * Use committed lines at save time. Any active line must normally
         * be committed before NetSuite permits the transaction to save.
         */
        updateHeaderTotalWeight(
            context.currentRecord,
            false
        );

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