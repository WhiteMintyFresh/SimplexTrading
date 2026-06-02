/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/currentRecord', 'N/url', 'N/ui/dialog'], (
    currentRecord,
    url,
    dialog
) => {
    const SUITELET_SCRIPT_ID = 'customscript_sl_last_purchased_items';
    const SUITELET_DEPLOYMENT_ID = 'customdeploy_sl_last_purchased_items';

    const pageInit = () => {
        // Required entry point for client script.
    };

    const openLastPurchasedItems = () => {
        const rec = currentRecord.get();

        const customerId = rec.getValue({
            fieldId: 'entity'
        });

        if (!customerId) {
            dialog.alert({
                title: 'Customer Required',
                message: 'Select a customer before using Last Purchased Items.'
            });
            return;
        }

        const suiteletUrl = url.resolveScript({
            scriptId: SUITELET_SCRIPT_ID,
            deploymentId: SUITELET_DEPLOYMENT_ID,
            params: {
                customer: customerId
            }
        });

        window.open(
            suiteletUrl,
            'lastPurchasedItems',
            'width=1100,height=750,resizable=yes,scrollbars=yes'
        );
    };

    return {
        pageInit,
        openLastPurchasedItems
    };
});