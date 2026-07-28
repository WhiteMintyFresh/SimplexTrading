/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * Hides Sales Order gross-profit fields from every role except:
 * - Administrator, internal ID 3
 * - Simplex Sales Manager, internal ID 1115
 */

define(['N/runtime', 'N/ui/serverWidget', 'N/log'], (
    runtime,
    serverWidget,
    log
) => {
    const ROLE = Object.freeze({
        ADMINISTRATOR: 3,
        SIMPLEX_SALES_MANAGER: 1115
    });

    const GROSS_PROFIT_FIELD_IDS = Object.freeze([
        'totalcostestimate',
        'estgrossprofit',
        'estgrossprofitpercent'
    ]);

    /**
     * Runs before the Sales Order form is displayed.
     *
     * @param {Object} context
     * @param {serverWidget.Form} context.form
     * @param {Record} context.newRecord
     */
    const beforeLoad = (context) => {
        try {
            const currentUser = runtime.getCurrentUser();
            const currentRoleId = Number(currentUser.role);

            const mayViewGrossProfit =
                currentRoleId === ROLE.ADMINISTRATOR ||
                currentRoleId === ROLE.SIMPLEX_SALES_MANAGER;

            if (mayViewGrossProfit) {
                return;
            }

            GROSS_PROFIT_FIELD_IDS.forEach((fieldId) => {
                hideBodyField(context.form, fieldId);
            });
        } catch (error) {
            log.error({
                title: 'Unable to apply gross-profit visibility',
                details: error
            });

            /*
             * Fail closed:
             * If the role check unexpectedly fails, attempt to hide the fields.
             */
            GROSS_PROFIT_FIELD_IDS.forEach((fieldId) => {
                hideBodyField(context.form, fieldId);
            });
        }
    };

    /**
     * Hides a body field when it exists on the current form.
     *
     * @param {serverWidget.Form} form
     * @param {string} fieldId
     */
    const hideBodyField = (form, fieldId) => {
        try {
            const field = form.getField({ id: fieldId });

            if (!field) {
                return;
            }

            field.updateDisplayType({
                displayType: serverWidget.FieldDisplayType.HIDDEN
            });
        } catch (error) {
            log.debug({
                title: `Field not available: ${fieldId}`,
                details: error
            });
        }
    };

    return {
        beforeLoad
    };
});