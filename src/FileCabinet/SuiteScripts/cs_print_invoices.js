/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/currentRecord'], currentRecord => {

    function pageInit(context) {
        // Required entry point.
    }

    function printInvoices() {
        const rec = currentRecord.get();

        const selectedInvoices = [];

        document.querySelectorAll('.inv-check:checked').forEach(checkbox => {
            selectedInvoices.push({
                id: checkbox.getAttribute('data-id'),
                number: checkbox.getAttribute('data-number')
            });
        });

        if (!selectedInvoices.length) {
            alert('Please select at least one invoice to print.');
            return;
        }

        rec.setValue({
            fieldId: 'custpage_action',
            value: 'print'
        });

        rec.setValue({
            fieldId: 'custpage_selected_invoices',
            value: JSON.stringify(selectedInvoices)
        });

        const form = document.forms[0];

        // Open the Suitelet POST response PDF in a new browser tab.
        form.target = '_blank';

        form.submit();

        // Reset the target so future refresh/search actions stay on the same tab.
        setTimeout(() => {
            form.target = '_self';

            rec.setValue({
                fieldId: 'custpage_action',
                value: ''
            });
        }, 500);
    }

    function markAllInvoices() {
        document.querySelectorAll('.inv-check').forEach(checkbox => {
            checkbox.checked = true;
        });
    }

    function unmarkAllInvoices() {
        document.querySelectorAll('.inv-check').forEach(checkbox => {
            checkbox.checked = false;
        });
    }

    function refreshInvoices() {
        const rec = currentRecord.get();

        rec.setValue({
            fieldId: 'custpage_action',
            value: ''
        });

        const form = document.forms[0];
        form.target = '_self';
        form.submit();
    }

    return {
        pageInit,
        printInvoices,
        markAllInvoices,
        unmarkAllInvoices,
        refreshInvoices
    };
});