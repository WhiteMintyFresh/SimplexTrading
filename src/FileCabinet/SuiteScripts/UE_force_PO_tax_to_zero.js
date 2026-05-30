/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/runtime', 'N/log'], (record, runtime, log) => {

    const ZERO_TAX_CODE_ID = '313'; // Internal ID of your 0% SuiteTax tax code
    const ZERO_TAX_RATE = 0;

    function afterSubmit(context) {
        try {
            if (
                context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT &&
                context.type !== context.UserEventType.COPY
            ) {
                return;
            }

            const poId = context.newRecord.id;

            const po = record.load({
                type: record.Type.PURCHASE_ORDER,
                id: poId,
                isDynamic: false
            });

            // Prevent endless resave loop
            const alreadyProcessed = po.getValue({
                fieldId: 'custbody_po_tax_removed'
            });

            if (alreadyProcessed) {
                return;
            }

            // Enable SuiteTax override
            po.setValue({
                fieldId: 'taxdetailsoverride',
                value: true
            });

            const taxLineCount = po.getLineCount({
                sublistId: 'taxdetails'
            });

            for (let i = 0; i < taxLineCount; i++) {
                po.setSublistValue({
                    sublistId: 'taxdetails',
                    fieldId: 'taxcode',
                    line: i,
                    value: ZERO_TAX_CODE_ID
                });

                po.setSublistValue({
                    sublistId: 'taxdetails',
                    fieldId: 'taxrate',
                    line: i,
                    value: ZERO_TAX_RATE
                });

                po.setSublistValue({
                    sublistId: 'taxdetails',
                    fieldId: 'taxamount',
                    line: i,
                    value: 0
                });
            }

            po.setValue({
                fieldId: 'custbody_po_tax_removed',
                value: true
            });

            po.save({
                enableSourcing: true,
                ignoreMandatoryFields: false
            });

        } catch (e) {
            log.error({
                title: 'Failed to remove SuiteTax from Purchase Order',
                details: e
            });
        }
    }

    return {
        afterSubmit
    };
});