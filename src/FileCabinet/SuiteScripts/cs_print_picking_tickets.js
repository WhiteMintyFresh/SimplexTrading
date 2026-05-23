/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {

    const FIELD_ACTION = 'custpage_action';
    const FIELD_SELECTED = 'custpage_selected_orders';

    function pageInit(context) {
        // Required entry point.
    }

    function setFieldValue(fieldId, value) {
        const field = document.getElementById(fieldId);

        if (field) {
            field.value = value || '';
        }
    }

    function getMainForm() {
        return document.forms[0];
    }

    function printPickingTickets() {
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

        setFieldValue(FIELD_ACTION, 'print');
        setFieldValue(FIELD_SELECTED, JSON.stringify(selectedOrders));

        const form = getMainForm();

        // Open PDF response in a new tab.
        form.target = '_blank';
        form.submit();

        // Reset the Suitelet page so later Refresh submits normally.
        setTimeout(() => {
            form.target = '_self';
            setFieldValue(FIELD_ACTION, '');
            setFieldValue(FIELD_SELECTED, '');
        }, 500);
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
        setFieldValue(FIELD_ACTION, '');
        setFieldValue(FIELD_SELECTED, '');

        const form = getMainForm();
        form.target = '_self';
        form.submit();
    }

    return {
        pageInit,
        printPickingTickets,
        markAllPickingTickets,
        unmarkAllPickingTickets,
        refreshPickingTickets
    };
});