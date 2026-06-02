/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define([], () => {
    const beforeLoad = (context) => {
        const form = context.form;

        if (
            context.type !== context.UserEventType.CREATE &&
            context.type !== context.UserEventType.EDIT &&
            context.type !== context.UserEventType.COPY
        ) {
            return;
        }

        form.clientScriptModulePath = './CS_LastPurchasedItemsButton.js';

        try {
            const itemSublist = form.getSublist({
                id: 'item'
            });

            itemSublist.addButton({
                id: 'custpage_last_purchased_items_btn',
                label: 'Last Purchased',
                functionName: 'openLastPurchasedItems'
            });
        } catch (e) {
            form.addButton({
                id: 'custpage_last_purchased_items_btn',
                label: 'Last Purchased Items',
                functionName: 'openLastPurchasedItems'
            });
        }
    };

    return {
        beforeLoad
    };
});