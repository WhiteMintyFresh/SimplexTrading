/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {
    const EXPENSE_SUBLIST = 'expense';

    const FIELD_QTY = 'custcol_expensequantity';
    const FIELD_RATE = 'custcol_expenserate';
    const FIELD_AMOUNT = 'amount';

    function fieldChanged(context) {
        const rec = context.currentRecord;

        if (context.sublistId !== EXPENSE_SUBLIST) {
            return;
        }

        if (![FIELD_QTY, FIELD_RATE].includes(context.fieldId)) {
            return;
        }

        calculateCurrentExpenseLine(rec);
    }

    function validateLine(context) {
        if (context.sublistId !== EXPENSE_SUBLIST) {
            return true;
        }

        calculateCurrentExpenseLine(context.currentRecord);
        return true;
    }

    function calculateCurrentExpenseLine(rec) {
        const qty = parseNumber(
            rec.getCurrentSublistValue({
                sublistId: EXPENSE_SUBLIST,
                fieldId: FIELD_QTY
            })
        );

        const rate = parseNumber(
            rec.getCurrentSublistValue({
                sublistId: EXPENSE_SUBLIST,
                fieldId: FIELD_RATE
            })
        );

        const amount = roundCurrency(qty * rate);

        rec.setCurrentSublistValue({
            sublistId: EXPENSE_SUBLIST,
            fieldId: FIELD_AMOUNT,
            value: amount,
            ignoreFieldChange: true
        });
    }

    function parseNumber(value) {
        if (value === null || value === undefined || value === '') {
            return 0;
        }

        const parsed = parseFloat(String(value).replace(/,/g, ''));
        return isNaN(parsed) ? 0 : parsed;
    }

    function roundCurrency(value) {
        return Math.round((value + Number.EPSILON) * 100) / 100;
    }

    return {
        fieldChanged,
        validateLine
    };
});