/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/currentRecord'], (currentRecord) => {
    const pageInit = () => {};

    const printInboundReceivingReport = () => {
        const rec = currentRecord.get();
        const reportUrl = rec.getValue({
            fieldId: 'custpage_receiving_report_url'
        });

        if (!reportUrl) {
            alert('The receiving report URL could not be generated.');
            return;
        }

        window.open(reportUrl, '_blank');
    };

    return {
        pageInit,
        printInboundReceivingReport
    };
});
