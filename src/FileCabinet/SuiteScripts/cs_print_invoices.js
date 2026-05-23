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

        document.forms[0].submit();
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

        document.forms[0].submit();
    }

    return {
        pageInit,
        printInvoices,
        markAllInvoices,
        unmarkAllInvoices,
        refreshInvoices
    };
});