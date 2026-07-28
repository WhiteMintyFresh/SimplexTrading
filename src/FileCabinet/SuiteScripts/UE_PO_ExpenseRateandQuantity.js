/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define([], () => {
    const EXPENSE_SUBLIST = 'expense';

    const FIELD_QTY = 'custcol_expensequantity';
    const FIELD_RATE = 'custcol_expenserate';
    const FIELD_AMOUNT = 'amount';

    function beforeSubmit(context) {
        const rec = context.newRecord;

        const lineCount = rec.getLineCount({
            sublistId: EXPENSE_SUBLIST
        });

        for (let i = 0; i < lineCount; i++) {
            const qty = parseNumber(
                rec.getSublistValue({
                    sublistId: EXPENSE_SUBLIST,
                    fieldId: FIELD_QTY,
                    line: i
                })
            );

            const rate = parseNumber(
                rec.getSublistValue({
                    sublistId: EXPENSE_SUBLIST,
                    fieldId: FIELD_RATE,
                    line: i
                })
            );

            const amount = roundCurrency(qty * rate);

            rec.setSublistValue({
                sublistId: EXPENSE_SUBLIST,
                fieldId: FIELD_AMOUNT,
                line: i,
                value: amount
            });
        }
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
        beforeSubmit
    };
});