/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/currentRecord'], currentRecord => {

    function pageInit(context) {
        // Required entry point.
    }

    function printPickingTickets() {
        const rec = currentRecord.get();

        const selectedOrders = [];

        document.querySelectorAll('.pt-check:checked').forEach(checkbox => {
            selectedOrders.push({
                id: checkbox.getAttribute('data-id'),
                number: checkbox.getAttribute('data-number')
            });
        });

        if (!selectedOrders.length) {
            alert('Please select at least one order to print.');
            return;
        }

        rec.setValue({
            fieldId: 'custpage_action',
            value: 'print'
        });

        rec.setValue({
            fieldId: 'custpage_selected_orders',
            value: JSON.stringify(selectedOrders)
        });

        document.forms[0].submit();
    }

    function markAllPickingTickets() {
        document.querySelectorAll('.pt-check').forEach(checkbox => {
            checkbox.checked = true;
        });
    }

    function unmarkAllPickingTickets() {
        document.querySelectorAll('.pt-check').forEach(checkbox => {
            checkbox.checked = false;
        });
    }

    function refreshPickingTickets() {
        document.forms[0].submit();
    }

    return {
        pageInit,
        printPickingTickets,
        markAllPickingTickets,
        unmarkAllPickingTickets,
        refreshPickingTickets
    };
});