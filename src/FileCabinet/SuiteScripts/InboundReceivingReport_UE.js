/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * Adds "Print Receiving Report" to an Inbound Shipment in View mode.
 */
define(['N/ui/serverWidget', 'N/url'], (serverWidget, url) => {
    const SUITELET_SCRIPT_ID = 'customscript_is_receiving_report_sl';
    const SUITELET_DEPLOYMENT_ID = 'customdeploy_is_receiving_report_sl';

    const beforeLoad = (context) => {
        if (context.type !== context.UserEventType.VIEW) {
            return;
        }

        const recordId = context.newRecord.id;
        if (!recordId) {
            return;
        }

        const reportUrl = url.resolveScript({
            scriptId: SUITELET_SCRIPT_ID,
            deploymentId: SUITELET_DEPLOYMENT_ID,
            params: { shipmentid: recordId }
        });

        const urlField = context.form.addField({
            id: 'custpage_receiving_report_url',
            type: serverWidget.FieldType.TEXT,
            label: 'Receiving Report URL'
        });
        urlField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });
        urlField.defaultValue = reportUrl;

        context.form.clientScriptModulePath =
            'SuiteScripts/InboundReceivingReport_CS.js';

        context.form.addButton({
            id: 'custpage_print_receiving_report',
            label: 'Print Receiving Report',
            functionName: 'printInboundReceivingReport'
        });
    };

    return { beforeLoad };
});
