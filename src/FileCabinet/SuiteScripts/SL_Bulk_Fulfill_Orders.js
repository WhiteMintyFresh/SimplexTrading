/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
    'N/ui/serverWidget',
    'N/search',
    'N/record',
    'N/runtime',
    'N/redirect',
    'N/format',
    'N/log',
    'N/render',
    'N/file',
    'N/config'
], (
    serverWidget,
    search,
    record,
    runtime,
    redirect,
    format,
    log,
    render,
    file,
    config
) => {

    const SUBLIST_ID = 'custpage_orders';

    const FLD_SELECT = 'custpage_select';
    const FLD_SO_ID = 'custpage_so_id';
    const FLD_TRANID = 'custpage_tranid';
    const FLD_CUSTOMER = 'custpage_customer';
    const FLD_DATE = 'custpage_date';
    const FLD_MEMO = 'custpage_memo';
    const FLD_CURRENCY = 'custpage_currency';
    const FLD_STATUS = 'custpage_status';
const FLD_CREATED_DATE = 'custpage_created_date';
const FLD_SHIP_DATE = 'custpage_ship_date';
const FLD_PO = 'custpage_po';
const FLD_ITEMS = 'custpage_items';
const FLD_LINE_DRIVER = 'custpage_line_driver';
const FLD_LINE_TRUCK = 'custpage_line_truck';

    /*
     * Number of source transaction search rows loaded per page.
     * Keep this moderate because each page also loads item details and builds expandable HTML rows.
     */
    const PAGE_SIZE = 200;

    const FLD_PAGE_INDEX = 'custpage_page_index';

    const SHIP_METHOD_SIMPLEX_DELIVERY = '526';

    const TRAN_TYPE_SALES_ORDER = 'SalesOrd';
    const TRAN_TYPE_TRANSFER_ORDER = 'TrnfrOrd';

    const FLD_TRANSACTION_TYPE_FILTER = 'custpage_transaction_type_filter';

    // Confirm/change this to the actual Transaction Body Field ID for Trip Number.
    const TRIP_NUMBER_FIELD_ID = 'custbody_simplex_trip_number';

    /*
     * Fulfill one order per browser request. Each request receives a fresh
     * Suitelet governance allowance, so large selections no longer exhaust
     * the original POST request while retaining the same user workflow.
     */
    const ASYNC_FULFILL_PARAM = 'custpage_async_fulfill';
    const MIN_USAGE_TO_START_ORDER = 250;
    const MIN_USAGE_TO_UPDATE_SOURCE = 100;

    /*
     * Combined fulfillment / picking-ticket action.
     *
     * Fulfillments continue to run one order per browser request. After all
     * successful fulfillment requests finish, the browser submits one fresh
     * Suitelet request that renders the selected tickets into a single PDF.
     */
    const FIELD_ACTION = 'custpage_action';
    const FIELD_SELECTED = 'custpage_selected_orders';
    const ACTION_PRINT_PICKING_TICKETS = 'print';
    const MAX_SUBMIT_AND_PRINT_ORDERS = 30;

    const PRINT_FIXED_USAGE_RESERVE = 200;
    const PRINT_USAGE_PER_TRANSACTION = 20;
    const PRINT_FINALIZATION_BUFFER = 30;
    const SEARCH_FILTER_ID_CHUNK_SIZE = 900;

    const SO_FIELD_PICKER = 'custbody_simplex_picked_by';
    const SO_FIELD_TRUCK = 'custbody_truck';
    const SO_FIELD_TRIP = 'custbody_simplex_trip_number';
    const SO_FIELD_SALES_REP = 'custbody_simplex_sale_rep';
    const SO_FIELD_PICKING_TICKET_MEMO = 'custbody_picking_ticket_memo';

    const DEFAULT_PRINTED_FIELD_ID = 'custbody_picking_ticket_printed';
    const PARAM_LOGO_FILE_ID = 'custscript_pt_logo_file_id';
    const PARAM_PRINTED_FIELD_ID = 'custscript_pt_printed_field_id';

    const vendorItemCodeCache = {};

    function onRequest(context) {
        if (context.request.method === 'GET') {
            renderForm(context);
            return;
        }

        const action = String(
            (context.request.parameters || {})[FIELD_ACTION] || ''
        );

        if (action === ACTION_PRINT_PICKING_TICKETS) {
            try {
                printPickingTickets(context);
            } catch (e) {
                log.error({
                    title: 'Combined picking-ticket print failed',
                    details: serializeError(e)
                });

                writeLightweightErrorPage(context, getErrorMessage(e));
            }

            return;
        }

        processFulfillments(context);
    }

    function renderForm(context, message) {
        const request = context.request;
        const params = request.parameters || {};

        const form = serverWidget.createForm({
    title: 'Simplex Fulfill Orders'
});
        form.addSubmitButton({
            label: 'Submit'
        });

        form.addButton({
            id: 'custpage_submit_and_print',
            label: 'Submit and Print',
            functionName: 'submitAndPrintFulfillments'
        });

        if (message) {
            const msgField = form.addField({
                id: 'custpage_message',
                label: 'Message',
                type: serverWidget.FieldType.INLINEHTML
            });

            msgField.defaultValue = `
                <div style="padding:10px;margin-bottom:12px;border:1px solid #c7d5e0;background:#f4f8fb;white-space:pre-line;">
                    ${escapeHtml(message)}
                </div>
            `;
        }

        const payloadFld = form.addField({
    id: 'custpage_fulfillment_payload',
    label: 'Fulfillment Payload',
    type: serverWidget.FieldType.LONGTEXT
});

payloadFld.updateDisplayType({
    displayType: serverWidget.FieldDisplayType.HIDDEN
});
      addFilterFields(form, params);
        addOrdersHtmlTable(form, params);

        context.response.writePage(form);
    }
  
function addOrdersHtmlTable(form, params) {
    log.debug({
        title: 'Suitelet Filter Params',
        details: JSON.stringify(params)
    });

    const pageData = getEligibleSalesOrders(params);
    const orders = pageData.orders || [];

    const htmlFld = form.addField({
        id: 'custpage_orders_html',
        label: 'Orders',
        type: serverWidget.FieldType.INLINEHTML
    });

    /*
     * This is the important part.
     * It forces the custom HTML table outside NetSuite's normal two-column field layout.
     */
    htmlFld.updateLayoutType({
        layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW
    });

    htmlFld.updateBreakType({
        breakType: serverWidget.FieldBreakType.STARTROW
    });

    htmlFld.defaultValue = buildOrdersHtml(orders, params, pageData);
}

  function buildOrdersHtml(orders, params, pageData) {
const pickerOptions = getCustomListOptions('customlist_spx_pickers');
const paginationHtml = buildPaginationHtml(pageData || {});

    let rowsHtml = '';

    if (!orders.length) {
        rowsHtml = `
            <tr>
                <td colspan="13" style="text-align:center;padding:14px;">
                    No records to show.
                </td>
            </tr>
        `;
    } else {
        orders.forEach((order, index) => {
            const rowId = `order_items_${order.id}`;

            rowsHtml += `
    <tr class="order-row" data-soid="${escapeHtml(order.id)}" data-recordtype="${escapeHtml(order.recordType)}">
        <td class="center">
            <button type="button" class="expand-btn" onclick="toggleItems('${rowId}', this)">+</button>
        </td>
        <td class="center">
            <input type="checkbox"
	       class="fulfill-check"
	       data-soid="${escapeHtml(order.id)}"
	       data-recordtype="${escapeHtml(order.recordType)}"
	       data-tranid="${escapeHtml(order.tranid)}"
	       data-weight="${escapeHtml(order.totalWeight || 0)}">
        </td>
        <td>${escapeHtml(order.typeLabel)}</td>
        <td>${escapeHtml(order.tranid)}</td>
        <td>${escapeHtml(order.customer)}</td>
        <td class="ship-address-cell">${formatAddressForHtml(order.shipAddress)}</td>
        <td>${escapeHtml(order.trandate)}</td>
        <td>${escapeHtml(order.shipdate)}</td>
        <td class="memo-cell">${escapeHtml(order.memo)}</td>
        <td>${escapeHtml(order.location)}</td>
        <td>${escapeHtml(order.createdDate)}</td>
        <td class="right">${escapeHtml(formatDisplayNumber(order.totalWeight || 0))}</td>
<td>
    <select class="line-picker" data-soid="${escapeHtml(order.id)}">
        ${buildSelectOptions(pickerOptions, '')}
    </select>
</td>
    </tr>

    <tr id="${rowId}" class="items-row" style="display:none;">
        <td colspan="13">
            ${buildItemsTable(order.items || [])}
        </td>
    </tr>
`;
        });
    }

    return `
        <style>
    .delivery-page {
        width: calc(100vw - 32px);
        max-width: calc(100vw - 32px);
        margin-left: -6px;
        margin-top: 8px;
        box-sizing: border-box;
        font-family: Arial, Helvetica, sans-serif;
    }

    .delivery-toolbar {
        margin-top: 8px;
        margin-bottom: 8px;
        display: flex;
        gap: 8px;
        align-items: center;
    }

    .delivery-toolbar button {
        padding: 6px 12px;
        border: 1px solid #b5b5b5;
        background: #ffffff;
        cursor: pointer;
        border-radius: 3px;
        color: #222222;
        font-size: 12px;
    }

    .delivery-toolbar button:hover {
        background: #f4f4f4;
    }

    .pagination-toolbar {
        margin: 8px 0;
        display: flex;
        gap: 8px;
        align-items: center;
        font-size: 12px;
    }

    .pagination-toolbar button {
        padding: 5px 10px;
        border: 1px solid #b5b5b5;
        background: #ffffff;
        cursor: pointer;
        border-radius: 3px;
        color: #222222;
        font-size: 12px;
    }

    .pagination-toolbar button:hover:not(:disabled) {
        background: #f4f4f4;
    }

    .pagination-toolbar button:disabled {
        color: #999999;
        cursor: not-allowed;
        background: #f5f5f5;
    }

    .pagination-summary {
        color: #333333;
    }

    .delivery-table-wrapper {
        width: 100%;
        max-width: 100%;
        min-height: calc(100vh - 330px);
        overflow-x: auto;
        overflow-y: auto;
        padding-bottom: 16px;
        box-sizing: border-box;
        border: 1px solid #d7d7d7;
        background: #ffffff;
    }

    .delivery-table {
        width: 100%;
        min-width: 1250px;
        border-collapse: collapse;
        font-size: 12px;
        table-layout: auto;
        background: #ffffff;
    }

    .delivery-table th {
        background: #f5f5f5;
        color: #222222;
        border: 1px solid #d0d0d0;
        border-bottom: 1px solid #bcbcbc;
        padding: 6px 5px;
        text-align: left;
        white-space: nowrap;
        font-weight: 600;
    }

    .delivery-table td {
        background: #ffffff;
        border: 1px solid #e1e1e1;
        padding: 5px 4px;
        vertical-align: top;
        white-space: nowrap;
        color: #222222;
    }

    .delivery-table tr.order-row:nth-child(4n+1) td {
        background: #ffffff;
    }

    .delivery-table tr.order-row:nth-child(4n+3) td {
        background: #fafafa;
    }

    .delivery-table tr.order-row:hover td {
        background: #eef6fb;
    }

    .items-row td {
        background: #fbfbfb !important;
    }

    .items-table {
        width: calc(100% - 30px);
        border-collapse: collapse;
        margin: 6px 0 10px 30px;
        font-size: 12px;
        background: #ffffff;
        border: 1px solid #d8d8d8;
    }

    .items-table th {
        background: #f7f7f7;
        color: #222222;
        border: 1px solid #d0d0d0;
        padding: 5px 4px;
        white-space: nowrap;
        font-weight: 600;
    }

    .items-table td {
        background: #ffffff;
        border: 1px solid #e1e1e1;
        padding: 5px 4px;
        white-space: nowrap;
    }

    .center {
        text-align: center;
    }

    .expand-btn {
        width: 22px;
        height: 22px;
        cursor: pointer;
        font-weight: bold;
        border: 1px solid #b5b5b5;
        background: #ffffff;
        border-radius: 2px;
        line-height: 18px;
    }

    .expand-btn:hover {
        background: #f4f4f4;
    }

    .weight-summary-box {
    margin-left: 18px;
    padding: 6px 10px;
    border: 1px solid #d0d0d0;
    background: #fafafa;
    font-size: 12px;
    line-height: 18px;
    min-width: 320px;
}

.right {
    text-align: right;
}

    .fulfill-check {
        cursor: pointer;
    }

.ship-address-cell {
    min-width: 260px;
    max-width: 360px;
    white-space: normal !important;
    line-height: 16px;
}

.memo-cell {
    min-width: 180px;
    max-width: 320px;
    white-space: pre-wrap !important;
    overflow-wrap: anywhere;
    line-height: 16px;
}

.line-picker {
    width: 150px;
    background: #ffffff;
    border: 1px solid #b5b5b5;
    height: 23px;
    box-sizing: border-box;
}

.fulfillment-progress {
    display: none;
    margin: 10px 0;
    padding: 12px;
    border: 1px solid #b8c9d8;
    background: #f6f9fc;
    color: #222222;
    font-size: 12px;
}

.fulfillment-progress-bar {
    width: 100%;
    height: 12px;
    margin: 8px 0;
    overflow: hidden;
    border: 1px solid #b5b5b5;
    background: #ffffff;
    border-radius: 2px;
}

.fulfillment-progress-fill {
    width: 0;
    height: 100%;
    background: #2f7d32;
    transition: width 0.2s ease;
}

.fulfillment-result-list {
    max-height: 220px;
    margin: 8px 0;
    padding-left: 24px;
    overflow-y: auto;
}

.fulfillment-result-success {
    color: #256b2a;
}

.fulfillment-result-warning {
    color: #8a5b00;
}

.fulfillment-result-error {
    color: #a12622;
}

.order-processed td {
    opacity: 0.55;
}
</style>

<div class="delivery-page">
<div class="delivery-toolbar">
    <button type="button" onclick="markAllCustom()">Mark All</button>
    <button type="button" onclick="unmarkAllCustom()">Unmark All</button>
    <button type="button" onclick="applyFiltersCustom()">Apply Filters</button>

    <div class="weight-summary-box">
    <div><strong>Selected Cu Ft:</strong> <span id="selected_weight_total">0</span></div>
    <div><strong>Cu Ft by Truck:</strong> <span id="selected_weight_by_truck">None</span></div>
</div>
</div>

<div id="fulfillment_progress" class="fulfillment-progress" role="status" aria-live="polite">
    <strong id="fulfillment_progress_title">Preparing fulfillment batch...</strong>
    <div class="fulfillment-progress-bar">
        <div id="fulfillment_progress_fill" class="fulfillment-progress-fill"></div>
    </div>
    <div id="fulfillment_progress_summary"></div>
    <ol id="fulfillment_result_list" class="fulfillment-result-list"></ol>
    <button id="fulfillment_refresh_button" type="button" style="display:none;" onclick="refreshFulfillmentPage()">
        Refresh List
    </button>
</div>

    ${paginationHtml}

    <div class="delivery-table-wrapper">
        <table class="delivery-table">
            <thead>
                <tr>
    <th></th>
    <th>Fulfill</th>
    <th>Type</th>
    <th>Order #</th>
    <th>Customer Name</th>
    <th>Shipping Address</th>
    <th>Order Date</th>
    <th>Ship Date</th>
    <th>Memo</th>
    <th>Location</th>
    <th>Date/Time Entered</th>
    <th>Cu Ft</th>
    <th>Picker</th>
</tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
</div>

${paginationHtml}
</div>
        <script>
            function toggleItems(rowId, button) {
                var row = document.getElementById(rowId);

                if (!row) {
                    return;
                }

                if (row.style.display === 'none') {
                    row.style.display = '';
                    button.innerHTML = '-';
                } else {
                    row.style.display = 'none';
                    button.innerHTML = '+';
                }
            }

            function markAllCustom() {
    document.querySelectorAll('.fulfill-check').forEach(function(cb) {
        cb.checked = true;
    });

    updateSelectedWeight();
}

            function unmarkAllCustom() {
    document.querySelectorAll('.fulfill-check').forEach(function(cb) {
        cb.checked = false;
    });

    updateSelectedWeight();
}

function updateSelectedWeight() {
    var totalWeight = 0;

    document.querySelectorAll('.fulfill-check:checked').forEach(function(cb) {
        var weight = parseFloat(cb.getAttribute('data-weight') || '0') || 0;
        totalWeight += weight;
    });

    var totalEl = document.getElementById('selected_weight_total');
    if (totalEl) {
        totalEl.innerHTML = formatWeightDisplay(totalWeight);
    }

    var truckEl = document.getElementById('selected_weight_by_truck');
    if (truckEl) {
        var truckSelect = document.getElementById('custpage_truck_value');
        var truckName = 'Unassigned';

        if (truckSelect && truckSelect.value) {
            truckName = truckSelect.options[truckSelect.selectedIndex].text || 'Unassigned';
        }

        truckEl.innerHTML = totalWeight ? truckName + ': ' + formatWeightDisplay(totalWeight) : 'None';
    }
}

function formatWeightDisplay(value) {
    value = parseFloat(value || '0') || 0;

    return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 5
    });
}

function goToFulfillOrdersPage(pageIndex) {
    if (typeof fulfillmentBatchRunning !== 'undefined' && fulfillmentBatchRunning) {
        alert('Wait for the current fulfillment batch to finish before changing pages.');
        return;
    }

    var currentUrl = new URL(window.location.href);

    currentUrl.searchParams.set('custpage_page_index', String(pageIndex || 0));

    window.onbeforeunload = null;

    if (typeof NS !== 'undefined' && NS.form && NS.form.setChanged) {
        NS.form.setChanged(false);
    }

    window.location.href = currentUrl.toString();
}

function getFieldValueSafe(fieldId) {
    var value = '';

    try {
        if (typeof nlapiGetFieldValue === 'function') {
            value = nlapiGetFieldValue(fieldId) || '';
        }
    } catch (e) {
        value = '';
    }

    if (!value) {
        var fld = document.getElementById(fieldId);
        if (fld) {
            value = fld.value || '';
        }
    }

    return value || '';
}
            function setUrlParam(url, fieldId) {
                var fld = document.getElementById(fieldId);
                if (fld) {
                    url.searchParams.set(fieldId, fld.value || '');
                }
            }

document.addEventListener('change', function(e) {
    if (
        e.target.classList.contains('fulfill-check') ||
        e.target.id === 'custpage_truck_value'
    ) {
        updateSelectedWeight();
    }
});

document.addEventListener('DOMContentLoaded', function() {
    updateSelectedWeight();
});

document.addEventListener('change', function(e) {
    if (
        e.target &&
        e.target.id === 'custpage_picker_value'
    ) {
        applyHeaderPickerToMarkedLines();
    }
});

function applyHeaderPickerToMarkedLines() {
    var pickerValue = getFieldValueSafe('custpage_picker_value');

    if (!pickerValue) {
        return;
    }

    document.querySelectorAll('.fulfill-check:checked').forEach(function(cb) {
        var soId = cb.getAttribute('data-soid');
        var picker = document.querySelector('.line-picker[data-soid="' + soId + '"]');

        if (picker) {
            picker.value = pickerValue;
        }
    });
}

var fulfillmentBatchRunning = false;
var submitAndPrintRequested = false;
var originalBeforeUnloadHandler = window.onbeforeunload;
var maxSubmitAndPrintOrders = ${MAX_SUBMIT_AND_PRINT_ORDERS};

function submitAndPrintFulfillments() {
    if (fulfillmentBatchRunning) {
        alert('Wait for the current fulfillment batch to finish.');
        return false;
    }

    var form = document.forms && document.forms.length
        ? document.forms[0]
        : null;

    if (!form) {
        alert('The Fulfill Orders form could not be found. Refresh the page and try again.');
        return false;
    }

    submitAndPrintRequested = true;

    var submitButton = form.querySelector(
        'input[type="submit"], button[type="submit"]'
    );

    if (typeof form.requestSubmit === 'function') {
        if (submitButton) {
            form.requestSubmit(submitButton);
        } else {
            form.requestSubmit();
        }
    } else if (submitButton && typeof submitButton.click === 'function') {
        submitButton.click();
    } else {
        submitAndPrintRequested = false;
        alert('Unable to start Submit and Print. Refresh the page and try again.');
    }

    return false;
}

function setFulfillmentSubmitDisabled(disabled) {
    document.querySelectorAll(
        'input[type="submit"], button[type="submit"], #custpage_submit_and_print'
    ).forEach(function(button) {
        button.disabled = disabled;
    });
}

function updateFulfillmentProgress(current, total, created, skipped, warnings, failed) {
    var percent = total ? Math.round((current / total) * 100) : 0;
    var fill = document.getElementById('fulfillment_progress_fill');
    var title = document.getElementById('fulfillment_progress_title');
    var summary = document.getElementById('fulfillment_progress_summary');

    if (fill) {
        fill.style.width = percent + '%';
    }

    if (title) {
        title.textContent = current < total
            ? 'Processing order ' + (current + 1) + ' of ' + total + '...'
            : 'Fulfillment batch complete.';
    }

    if (summary) {
        summary.textContent =
            'Processed: ' + current + ' of ' + total +
            ' | Created: ' + created +
            ' | Already fulfilled: ' + skipped +
            ' | Warnings: ' + warnings +
            ' | Failed: ' + failed;
    }
}

function appendFulfillmentResult(message, status) {
    var list = document.getElementById('fulfillment_result_list');

    if (!list) {
        return;
    }

    var item = document.createElement('li');
    item.textContent = message || 'No result message was returned.';
    item.className = 'fulfillment-result-' + (status === 'error' ? 'error' : status === 'warning' ? 'warning' : 'success');
    list.appendChild(item);
    list.scrollTop = list.scrollHeight;
}

function markOrderProcessed(orderId, status) {
    var checkbox = document.querySelector('.fulfill-check[data-soid="' + orderId + '"]');

    if (!checkbox) {
        return;
    }

    if (status === 'success' || status === 'skipped') {
        checkbox.checked = false;
        checkbox.disabled = true;

        var orderRow = checkbox.closest('tr.order-row');
        if (orderRow) {
            orderRow.classList.add('order-processed');
        }
    }

    updateSelectedWeight();
}

function refreshFulfillmentPage() {
    window.onbeforeunload = null;

    if (typeof NS !== 'undefined' && NS.form && NS.form.setChanged) {
        NS.form.setChanged(false);
    }

    window.location.reload();
}

function setPickingTicketWindowMessage(printTarget, title, message) {
    if (!printTarget || !printTarget.window || printTarget.window.closed) {
        return;
    }

    try {
        var printDocument = printTarget.window.document;
        printDocument.open();
        printDocument.write(
            '<!doctype html><html><head><meta charset="utf-8">' +
            '<title>Picking Tickets</title></head>' +
            '<body style="font-family:Arial,sans-serif;padding:24px;">' +
            '<h2 id="spx_print_title"></h2>' +
            '<p id="spx_print_message"></p></body></html>'
        );
        printDocument.close();

        printDocument.getElementById('spx_print_title').textContent =
            title || 'Picking Tickets';
        printDocument.getElementById('spx_print_message').textContent =
            message || '';
    } catch (ignored) {
        // The final Suitelet response will replace this temporary page.
    }
}

function openPickingTicketWindow(orderCount) {
    var windowName = 'spx_picking_tickets_' + String(Date.now());
    var printWindow = window.open('', windowName);

    if (!printWindow) {
        return null;
    }

    var printTarget = {
        window: printWindow,
        name: windowName
    };

    setPickingTicketWindowMessage(
        printTarget,
        'Preparing Picking Tickets',
        'Creating Item Fulfillments for ' + orderCount +
            ' selected order(s). Keep this tab open.'
    );

    return printTarget;
}

function addHiddenPrintField(form, name, value) {
    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value === null || value === undefined ? '' : String(value);
    form.appendChild(input);
}

function submitPickingTicketPrintRequest(sourceForm, printableOrders, printTarget) {
    if (!printTarget || !printTarget.window || printTarget.window.closed) {
        throw new Error('The picking-ticket tab was closed before the PDF could be generated.');
    }

    var postForm = document.createElement('form');
    postForm.method = 'POST';
    postForm.action = window.location.href;
    postForm.target = printTarget.name;
    postForm.style.display = 'none';

    var overriddenFields = {
        custpage_action: true,
        custpage_selected_orders: true,
        custpage_async_fulfill: true,
        custpage_fulfillment_payload: true
    };

    var sourceData = new FormData(sourceForm);

    sourceData.forEach(function(value, key) {
        if (!overriddenFields[key] && typeof value === 'string') {
            addHiddenPrintField(postForm, key, value);
        }
    });

    addHiddenPrintField(postForm, 'custpage_action', 'print');
    addHiddenPrintField(
        postForm,
        'custpage_selected_orders',
        JSON.stringify(printableOrders)
    );
    addHiddenPrintField(postForm, 'custpage_async_fulfill', 'F');
    addHiddenPrintField(postForm, 'custpage_fulfillment_payload', '[]');

    document.body.appendChild(postForm);
    postForm.submit();

    window.setTimeout(function() {
        if (postForm.parentNode) {
            postForm.parentNode.removeChild(postForm);
        }
    }, 1000);
}

async function submitOneFulfillment(form, order) {
    var postData = new FormData(form);
    postData.set('custpage_fulfillment_payload', JSON.stringify([order]));
    postData.set('custpage_async_fulfill', 'T');
    postData.set('custpage_picker_value', order.picker || '');
    postData.set('custpage_truck_value', order.truck || '');
    postData.set('custpage_trip_number_value', order.tripNumber || '');
    postData.set('custpage_fulfillment_date', order.fulfillmentDate || '');

    var response = await fetch(window.location.href, {
        method: 'POST',
        credentials: 'same-origin',
        body: postData,
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    });

    var responseText = await response.text();
    var responseData;

    try {
        responseData = JSON.parse(responseText);
    } catch (parseError) {
        throw new Error('NetSuite returned an unexpected response. Refresh the page and verify the Script Execution Log before retrying this order.');
    }

    if (!response.ok || !responseData || !responseData.results || !responseData.results.length) {
        throw new Error(
            responseData && responseData.message
                ? responseData.message
                : 'The Suitelet did not return a fulfillment result.'
        );
    }

    return responseData.results[0];
}

async function processFulfillmentQueue(form, payload, shouldPrint) {
    var progress = document.getElementById('fulfillment_progress');
    var refreshButton = document.getElementById('fulfillment_refresh_button');
    var resultList = document.getElementById('fulfillment_result_list');
    var created = 0;
    var skipped = 0;
    var warnings = 0;
    var failed = 0;
    var printableOrders = [];
    var printableOrderIds = {};
    var printTarget = null;

    if (shouldPrint) {
        printTarget = openPickingTicketWindow(payload.length);

        if (!printTarget) {
            alert(
                'NetSuite could not open the picking-ticket tab. Allow pop-ups for NetSuite, then click Submit and Print again. No orders were processed.'
            );
            return;
        }
    }

    fulfillmentBatchRunning = true;
    setFulfillmentSubmitDisabled(true);

    if (progress) {
        progress.style.display = 'block';
    }

    if (resultList) {
        resultList.innerHTML = '';
    }

    if (refreshButton) {
        refreshButton.style.display = 'none';
    }

    updateFulfillmentProgress(0, payload.length, created, skipped, warnings, failed);

    window.onbeforeunload = function(event) {
        if (!fulfillmentBatchRunning) {
            return undefined;
        }

        var warningText = 'Fulfillments are still being processed.';
        event.preventDefault();
        event.returnValue = warningText;
        return warningText;
    };

    for (var i = 0; i < payload.length; i++) {
        var order = payload[i];
        updateFulfillmentProgress(i, payload.length, created, skipped, warnings, failed);

        try {
            var result = await submitOneFulfillment(form, order);
            var status = result.status || (result.success ? 'success' : 'error');

            if (status === 'success') {
                created++;
            } else if (status === 'skipped') {
                skipped++;
            } else if (status === 'warning') {
                warnings++;
            } else {
                failed++;
                status = 'error';
            }

            appendFulfillmentResult(result.message, status);
            markOrderProcessed(order.soId, status);

            if (
                shouldPrint &&
                result &&
                result.fulfillmentId &&
                status !== 'error' &&
                !printableOrderIds[String(order.soId)]
            ) {
                printableOrderIds[String(order.soId)] = true;
                printableOrders.push({
                    id: String(order.soId)
                });
            }
        } catch (requestError) {
            failed++;
            appendFulfillmentResult(
                (order.tranId || ('Order ' + order.soId)) + ': FAILED - ' + (requestError.message || requestError),
                'error'
            );
        }

        updateFulfillmentProgress(i + 1, payload.length, created, skipped, warnings, failed);
    }

    fulfillmentBatchRunning = false;
    window.onbeforeunload = originalBeforeUnloadHandler;
    setFulfillmentSubmitDisabled(false);

    if (refreshButton) {
        refreshButton.style.display = '';
    }

    if (shouldPrint && printTarget) {
        if (!printableOrders.length) {
            setPickingTicketWindowMessage(
                printTarget,
                'No Picking Tickets Generated',
                'None of the selected orders produced a printable Item Fulfillment. Review the fulfillment results on the original page.'
            );
            return;
        }

        try {
            setPickingTicketWindowMessage(
                printTarget,
                'Generating Picking Tickets',
                'Building one PDF for ' + printableOrders.length +
                    ' successfully fulfilled order(s)...'
            );

            submitPickingTicketPrintRequest(
                form,
                printableOrders,
                printTarget
            );

            appendFulfillmentResult(
                'Picking-ticket PDF requested for ' + printableOrders.length +
                    ' successfully fulfilled order(s). Failed orders were not included.',
                'success'
            );
        } catch (printError) {
            setPickingTicketWindowMessage(
                printTarget,
                'Picking Tickets Could Not Be Opened',
                printError.message || String(printError)
            );

            appendFulfillmentResult(
                'Fulfillments finished, but the picking-ticket PDF could not be requested: ' +
                    (printError.message || printError),
                'error'
            );
        }
    }
}

document.addEventListener('submit', function(e) {
    var shouldPrint = submitAndPrintRequested;
    submitAndPrintRequested = false;

    if (fulfillmentBatchRunning) {
        if (e && e.preventDefault) {
            e.preventDefault();
        }
        return false;
    }

    var tripNumber = getFieldValueSafe('custpage_trip_number_value');

    if (!tripNumber) {
        alert('Trip # is required.');
        if (e && e.preventDefault) {
            e.preventDefault();
        }
        return false;
    }

    var payload = [];
    var seenOrderIds = {};

    document.querySelectorAll('.fulfill-check:checked').forEach(function(cb) {
        var soId = cb.getAttribute('data-soid');

        if (!soId || seenOrderIds[soId]) {
            return;
        }

        seenOrderIds[soId] = true;

        var recordType = cb.getAttribute('data-recordtype') || 'salesorder';
        var tranId = cb.getAttribute('data-tranid') || '';
        var linePicker = document.querySelector('.line-picker[data-soid="' + soId + '"]');
        var pickerValue = getFieldValueSafe('custpage_picker_value');
        var truckValue = getFieldValueSafe('custpage_truck_value');
        var fulfillmentDate = getFieldValueSafe('custpage_fulfillment_date');

        payload.push({
            soId: soId,
            tranId: tranId,
            recordType: recordType,
            picker: pickerValue || (linePicker ? linePicker.value : ''),
            truck: truckValue || '',
            tripNumber: tripNumber || '',
            fulfillmentDate: fulfillmentDate || ''
        });
    });

    var payloadField = document.getElementById('custpage_fulfillment_payload');

    if (payloadField) {
        payloadField.value = JSON.stringify(payload);
    }

    if (!payload.length) {
        alert('Select at least one order to fulfill.');
        if (e && e.preventDefault) {
            e.preventDefault();
        }
        return false;
    }

    if (payload.some(function(order) { return !order.truck; })) {
        alert('Truck Number is required.');
        if (e && e.preventDefault) {
            e.preventDefault();
        }
        return false;
    }

    if (payload.some(function(order) { return !order.picker; })) {
        alert('Picker is required for every selected order.');
        if (e && e.preventDefault) {
            e.preventDefault();
        }
        return false;
    }

    if (shouldPrint && payload.length > maxSubmitAndPrintOrders) {
        alert(
            'Submit and Print supports up to ' + maxSubmitAndPrintOrders +
            ' orders per combined PDF. Select fewer orders and try again. No orders were processed.'
        );
        if (e && e.preventDefault) {
            e.preventDefault();
        }
        return false;
    }

    /*
     * Modern NetSuite-supported browsers use one lightweight POST per order.
     * If fetch/FormData is unavailable, the original server POST remains as a fallback.
     */
    if (typeof window.fetch !== 'function' || typeof window.FormData !== 'function') {
        if (shouldPrint) {
            alert(
                'Submit and Print requires a current NetSuite-supported browser. No orders were processed.'
            );
            if (e && e.preventDefault) {
                e.preventDefault();
            }
            return false;
        }

        return true;
    }

    if (e && e.preventDefault) {
        e.preventDefault();
    }

    processFulfillmentQueue(e.target, payload, shouldPrint);
    return false;
});
        </script>
    `;
}

function getCustomListOptions(listScriptId) {
    const options = [
        {
            id: '',
            name: ''
        }
    ];

    try {
        const listSearch = search.create({
            type: listScriptId,
            filters: [
                ['isinactive', 'is', 'F']
            ],
            columns: [
                search.createColumn({
                    name: 'name',
                    sort: search.Sort.ASC
                }),
                search.createColumn({
                    name: 'internalid'
                })
            ]
        });

        listSearch.run().each(result => {
            const id = result.getValue({
                name: 'internalid'
            });

            const name = result.getValue({
                name: 'name'
            });

            if (id && name) {
                options.push({
                    id: String(id),
                    name: String(name)
                });
            }

            return true;
        });
    } catch (e) {
        log.error({
            title: `Unable to load custom list options: ${listScriptId}`,
            details: e
        });
    }

    return options;
}

  function buildSelectOptions(options, selectedValue) {
    return options.map(option => {
        const selected = String(option.id) === String(selectedValue || '') ? 'selected' : '';

        return `
            <option value="${escapeHtml(option.id)}" ${selected}>
                ${escapeHtml(option.name)}
            </option>
        `;
    }).join('');
}



function buildPaginationHtml(pageData) {
    const pageIndex = Number(pageData.pageIndex || 0);
    const pageCount = Number(pageData.pageCount || 0);
    const resultCount = Number(pageData.resultCount || 0);
    const pageSize = Number(pageData.pageSize || PAGE_SIZE);
    const hasPrevious = pageData.hasPrevious === true;
    const hasNext = pageData.hasNext === true;
    const startRow = resultCount && pageCount ? (pageIndex * pageSize) + 1 : 0;
    const endRow = resultCount && pageCount ? Math.min((pageIndex + 1) * pageSize, resultCount) : 0;
    const visibleResultCount = Number(pageData.visibleResultCount || 0);

    const previousDisabled = hasPrevious ? '' : 'disabled';
    const nextDisabled = hasNext ? '' : 'disabled';
    const previousPage = Math.max(pageIndex - 1, 0);
    const nextPage = pageIndex + 1;

    return `
        <div class="pagination-toolbar">
            <button type="button" ${previousDisabled} onclick="goToFulfillOrdersPage(${previousPage})">
                Previous Page
            </button>

            <button type="button" ${nextDisabled} onclick="goToFulfillOrdersPage(${nextPage})">
                Next Page
            </button>

            <span class="pagination-summary">
                Page ${pageCount ? pageIndex + 1 : 0} of ${pageCount || 0}
                &nbsp;|&nbsp;
                Search rows ${startRow}-${endRow} of ${resultCount}
                &nbsp;|&nbsp;
                Visible orders on this page: ${visibleResultCount}
            </span>
        </div>
    `;
}

function formatAddressForHtml(value) {
    return escapeHtml(value || '')
        .replace(/&lt;br\s*\/??&gt;/gi, '<br>')
        .replace(/\r?\n/g, '<br>');
}

function buildItemsTable(items) {
    if (!items.length) {
        return `
            <div style="padding:8px;">
                No item lines found.
            </div>
        `;
    }

    const itemRows = items.map(line => {
        return `
            <tr>
                <td>${escapeHtml(line.line)}</td>
                <td>${escapeHtml(line.item)}</td>
                <td>${escapeHtml(line.displayName)}</td>
                <td>${escapeHtml(line.description)}</td>
                <td class="center">${escapeHtml(line.orderQty)}</td>
                <td class="center">${escapeHtml(line.shipQty)}</td>
                <td>${escapeHtml(line.unit)}</td>
                <td>${escapeHtml(line.unitPrice)}</td>
                <td>${escapeHtml(line.extended)}</td>
                <td>${escapeHtml(line.extWeight)}</td>
            </tr>
        `;
    }).join('');

    return `
        <table class="items-table">
            <thead>
                <tr>
                    <th>Line</th>
                    <th>Item</th>
                    <th>Display Name</th>
                    <th>Description</th>
                    <th>Order Qty</th>
                    <th>Ship Qty</th>
                    <th>UM</th>
                    <th>Unit Price</th>
                    <th>Extended</th>
                    <th>Ext Weight</th>
                </tr>
            </thead>
            <tbody>
                ${itemRows}
            </tbody>
        </table>
    `;
}

    function addFilterFields(form, params) {
        form.addFieldGroup({
            id: 'custpage_filter_group',
            label: 'Filters'
        });

        form.addFieldGroup({
            id: 'custpage_settings_group',
            label: 'Set Fulfillment Values'
        });

        const locationFld = form.addField({
            id: 'custpage_location_filter',
            label: 'Location',
            type: serverWidget.FieldType.SELECT,
            source: 'location',
            container: 'custpage_filter_group'
        });
        locationFld.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.STARTROW
        });
        locationFld.defaultValue = params.custpage_location_filter || '';

        const customerFld = form.addField({
            id: 'custpage_customer_filter',
            label: 'Customer',
            type: serverWidget.FieldType.SELECT,
            source: 'customer',
            container: 'custpage_filter_group'
        });
        customerFld.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.MIDROW
        });
        customerFld.defaultValue = params.custpage_customer_filter || '';

        const orderNumberFld = form.addField({
            id: 'custpage_order_number_filter',
            label: 'Order #',
            type: serverWidget.FieldType.TEXT,
            container: 'custpage_filter_group'
        });
        orderNumberFld.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.MIDROW
        });
        orderNumberFld.defaultValue = params.custpage_order_number_filter || '';

        const transactionTypeFld = form.addField({
            id: FLD_TRANSACTION_TYPE_FILTER,
            label: 'Order Type',
            type: serverWidget.FieldType.SELECT,
            container: 'custpage_filter_group'
        });
        transactionTypeFld.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.ENDROW
        });
        transactionTypeFld.addSelectOption({
            value: '',
            text: '- Sales Orders and Transfer Orders -'
        });
        transactionTypeFld.addSelectOption({
            value: TRAN_TYPE_SALES_ORDER,
            text: 'Sales Order'
        });
        transactionTypeFld.addSelectOption({
            value: TRAN_TYPE_TRANSFER_ORDER,
            text: 'Transfer Order'
        });
        transactionTypeFld.defaultValue =
            params[FLD_TRANSACTION_TYPE_FILTER] === TRAN_TYPE_SALES_ORDER ||
            params[FLD_TRANSACTION_TYPE_FILTER] === TRAN_TYPE_TRANSFER_ORDER
                ? params[FLD_TRANSACTION_TYPE_FILTER]
                : '';

        const zoneFld = form.addField({
            id: 'custpage_zone_filter',
            label: 'Zone',
            type: serverWidget.FieldType.SELECT,
            container: 'custpage_filter_group'
        });
        zoneFld.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.STARTROW
        });

        zoneFld.addSelectOption({
            value: '',
            text: '- All -'
        });

        getZoneOptions().forEach(zone => {
            zoneFld.addSelectOption({
                value: zone.id,
                text: zone.text
            });
        });
        zoneFld.defaultValue = params.custpage_zone_filter || '';

        const sortDirFld = form.addField({
            id: 'custpage_created_sort',
            label: 'Date/Time Entered Sort',
            type: serverWidget.FieldType.SELECT,
            container: 'custpage_filter_group'
        });
        sortDirFld.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.MIDROW
        });
        sortDirFld.addSelectOption({
            value: 'ASC',
            text: 'Ascending'
        });
        sortDirFld.addSelectOption({
            value: 'DESC',
            text: 'Descending'
        });
        sortDirFld.defaultValue = params.custpage_created_sort || 'DESC';

        const availabilityFld = form.addField({
            id: 'custpage_availability_filter',
            label: 'Availability Filter',
            type: serverWidget.FieldType.SELECT,
            container: 'custpage_filter_group'
        });
        availabilityFld.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.STARTROW
        });
        availabilityFld.addSelectOption({
            value: 'IGNORE',
            text: 'Ignore Item Availability'
        });
        availabilityFld.addSelectOption({
            value: 'SOME_COMMITTED',
            text: 'Some Items Committed'
        });
        availabilityFld.addSelectOption({
            value: 'ALL_FULLY_COMMITTED',
            text: 'All Items Fully Committed'
        });
        availabilityFld.addSelectOption({
            value: 'ANY_OPEN',
            text: 'Any Open Quantity'
        });
        availabilityFld.defaultValue = params.custpage_availability_filter || 'ANY_OPEN';

        const dateFld = form.addField({
            id: 'custpage_fulfillment_date',
            label: 'Fulfillment Date',
            type: serverWidget.FieldType.DATE,
            container: 'custpage_settings_group'
        });
        dateFld.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.STARTROW
        });
        dateFld.defaultValue = params.custpage_fulfillment_date || getTodayString();

        const pickerValueFld = form.addField({
            id: 'custpage_picker_value',
            label: 'Picker',
            type: serverWidget.FieldType.SELECT,
            source: 'customlist_spx_pickers',
            container: 'custpage_settings_group'
        });
        pickerValueFld.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.MIDROW
        });
        pickerValueFld.defaultValue = params.custpage_picker_value || '';

        const truckValueFld = form.addField({
            id: 'custpage_truck_value',
            label: 'Truck Number',
            type: serverWidget.FieldType.SELECT,
            source: 'customlist_truck_fulfillment',
            container: 'custpage_settings_group'
        });
        truckValueFld.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.MIDROW
        });
        truckValueFld.defaultValue = params.custpage_truck_value || '';

        const tripNumberValueFld = form.addField({
            id: 'custpage_trip_number_value',
            label: 'Trip #',
            type: serverWidget.FieldType.TEXT,
            container: 'custpage_settings_group'
        });
        tripNumberValueFld.updateLayoutType({
            layoutType: serverWidget.FieldLayoutType.ENDROW
        });
        tripNumberValueFld.isMandatory = true;
        tripNumberValueFld.defaultValue = params.custpage_trip_number_value || '';

        form.addButton({
            id: 'custpage_apply_filters',
            label: 'Apply Filters',
            functionName: 'applyFiltersCustom'
        });

        form.addField({
            id: 'custpage_filter_script',
            label: ' ',
            type: serverWidget.FieldType.INLINEHTML
        }).defaultValue = `
<style>
#custpage_order_number_filter,
#custpage_transaction_type_filter,
#custpage_customer_filter,
#custpage_fulfillment_date,
#custpage_zone_filter,
#custpage_location_filter,
#custpage_created_sort,
#custpage_availability_filter,
#custpage_picker_value,
#custpage_truck_value,
#custpage_trip_number_value {
    max-width: 220px;
}
</style>
<script>
    function applyFiltersCustom() {
        if (typeof fulfillmentBatchRunning !== 'undefined' && fulfillmentBatchRunning) {
            alert('Wait for the current fulfillment batch to finish before applying filters.');
            return;
        }

        var baseUrl = window.location.href.split('?')[0];
        var currentUrl = new URL(window.location.href);
        var newUrl = new URL(baseUrl);

        // Preserve NetSuite script/deployment params.
        ['script', 'deploy', 'compid', 'whence'].forEach(function(param) {
            if (currentUrl.searchParams.has(param)) {
                newUrl.searchParams.set(param, currentUrl.searchParams.get(param));
            }
        });

        setSuiteletUrlParam(newUrl, 'custpage_order_number_filter');
        setSuiteletUrlParam(newUrl, 'custpage_transaction_type_filter');
        setSuiteletUrlParam(newUrl, 'custpage_customer_filter');
        setSuiteletUrlParam(newUrl, 'custpage_zone_filter');
        setSuiteletUrlParam(newUrl, 'custpage_location_filter');
        setSuiteletUrlParam(newUrl, 'custpage_created_sort');
        setSuiteletUrlParam(newUrl, 'custpage_availability_filter');

        // Reset to the first page whenever filters are applied.
        newUrl.searchParams.set('custpage_page_index', '0');

        // Preserve setting values when filters are applied, but do not use them as filters.
        setSuiteletUrlParam(newUrl, 'custpage_fulfillment_date');
        setSuiteletUrlParam(newUrl, 'custpage_picker_value');
        setSuiteletUrlParam(newUrl, 'custpage_truck_value');
        setSuiteletUrlParam(newUrl, 'custpage_trip_number_value');

        // Prevent NetSuite/browser dirty-page warning.
        window.onbeforeunload = null;

        if (typeof NS !== 'undefined' && NS.form && NS.form.setChanged) {
            NS.form.setChanged(false);
        }

        window.location.href = newUrl.toString();
    }

    function setSuiteletUrlParam(url, fieldId) {
        var value = '';

        try {
            if (typeof nlapiGetFieldValue === 'function') {
                value = nlapiGetFieldValue(fieldId) || '';
            }
        } catch (e) {
            value = '';
        }

        if (!value) {
            var fld = document.getElementById(fieldId);
            if (fld) {
                value = fld.value || '';
            }
        }

        if (value) {
            url.searchParams.set(fieldId, value);
        } else {
            url.searchParams.delete(fieldId);
        }
    }
</script>
`;
    }
  function getZoneOptions() {
    const zones = {};
    const results = [];

    const customerSearch = search.create({
        type: search.Type.CUSTOMER,
        filters: [
            ['isinactive', 'is', 'F'],
            'AND',
            ['custentity_simplex_zone', 'noneof', '@NONE@']
        ],
        columns: [
            search.createColumn({
                name: 'custentity_simplex_zone',
                sort: search.Sort.ASC
            })
        ]
    });

    customerSearch.run().each(result => {
        const id = result.getValue({
            name: 'custentity_simplex_zone'
        });

        const text = result.getText({
            name: 'custentity_simplex_zone'
        });

        if (id && !zones[id]) {
            zones[id] = true;

            results.push({
                id,
                text: text || id
            });
        }

        return true;
    });

    return results;
}

    function addOrdersSublist(form, params) {
    const sublist = form.addSublist({
        id: SUBLIST_ID,
        label: 'Orders',
        type: serverWidget.SublistType.LIST
    });

    sublist.addField({
        id: FLD_SELECT,
        label: 'Fulfill',
        type: serverWidget.FieldType.CHECKBOX
    });

    sublist.addField({
        id: FLD_SO_ID,
        label: 'Internal ID',
        type: serverWidget.FieldType.TEXT
    }).updateDisplayType({
        displayType: serverWidget.FieldDisplayType.HIDDEN
    });

    sublist.addField({
        id: FLD_TRANID,
        label: 'Order #',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_STATUS,
        label: 'Status',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_PO,
        label: 'PO #',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_DATE,
        label: 'Order Date',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_SHIP_DATE,
        label: 'Ship Date',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_CUSTOMER,
        label: 'Customer Name',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_ITEMS,
        label: 'Items',
        type: serverWidget.FieldType.TEXTAREA
    });

    sublist.addField({
        id: FLD_CREATED_DATE,
        label: 'Entered Date/Time',
        type: serverWidget.FieldType.TEXT
    });

    const driverFld = sublist.addField({
        id: FLD_LINE_DRIVER,
        label: 'Picker / Driver',
        type: serverWidget.FieldType.SELECT
    });

    driverFld.addSelectOption({
        value: '',
        text: ''
    });

    driverFld.addSelectOption({
        value: '1',
        text: 'Driver 1'
    });

    driverFld.addSelectOption({
        value: '2',
        text: 'Driver 2'
    });

    driverFld.addSelectOption({
        value: '3',
        text: 'Driver 3'
    });

    const truckFld = sublist.addField({
        id: FLD_LINE_TRUCK,
        label: 'Truck',
        type: serverWidget.FieldType.SELECT
    });

    truckFld.addSelectOption({
        value: '',
        text: ''
    });

    truckFld.addSelectOption({
        value: '1',
        text: 'ABC 123'
    });

    sublist.addField({
        id: FLD_MEMO,
        label: 'Memo',
        type: serverWidget.FieldType.TEXT
    });

    sublist.addField({
        id: FLD_CURRENCY,
        label: 'Currency',
        type: serverWidget.FieldType.TEXT
    });
log.debug({
    title: 'Suitelet Filter Params',
    details: JSON.stringify(params)
});
    const pageData = getEligibleSalesOrders(params);
    const orders = pageData.orders || [];

    if (!orders.length) {
        return;
    }

    orders.forEach((order, index) => {
        setSublistValueSafe(sublist, FLD_SO_ID, index, String(order.id));
        setSublistValueSafe(sublist, FLD_TRANID, index, order.tranid);
        setSublistValueSafe(sublist, FLD_STATUS, index, order.status);
        setSublistValueSafe(sublist, FLD_PO, index, order.po);
        setSublistValueSafe(sublist, FLD_DATE, index, order.trandate);
        setSublistValueSafe(sublist, FLD_SHIP_DATE, index, order.shipdate);
        setSublistValueSafe(sublist, FLD_CUSTOMER, index, order.customer);
        setSublistValueSafe(sublist, FLD_ITEMS, index, order.items);
        setSublistValueSafe(sublist, FLD_CREATED_DATE, index, order.createdDate);
        setSublistValueSafe(sublist, FLD_MEMO, index, order.memo);
        setSublistValueSafe(sublist, FLD_CURRENCY, index, order.currency);
    });
}

function getUniqueOrdersById(orders) {
    const seen = {};
    const uniqueOrders = [];

    (orders || []).forEach(order => {
        if (!order || !order.id) {
            return;
        }

        if (seen[order.id]) {
            return;
        }

        seen[order.id] = true;
        uniqueOrders.push(order);
    });

    return uniqueOrders;
}

function setSublistValueSafe(sublist, fieldId, line, value) {
    if (value !== null && value !== undefined && value !== '') {
        sublist.setSublistValue({
            id: fieldId,
            line,
            value: String(value)
        });
    }
}

/*
 * A line-level transaction search can expose Transfer Order location context
 * differently from the Transfer Order body. Resolve matching Transfer Orders
 * from mainline rows first, where "location" is the body From Location.
 */
function getTransferOrdersByFromLocation(locationId, params) {
    const result = {
        ids: [],
        fromLocationByOrderId: {},
        searchFailed: false
    };

    if (!locationId) {
        return result;
    }

    const fromLocationFilters = [
        ['type', 'anyof', TRAN_TYPE_TRANSFER_ORDER],
        'AND',
        ['mainline', 'is', 'T'],
        'AND',
        ['location', 'anyof', locationId],
        'AND',
        ['shipmethod', 'anyof', SHIP_METHOD_SIMPLEX_DELIVERY]
    ];

    if (params.custpage_order_number_filter) {
        fromLocationFilters.push(
            'AND',
            ['tranid', 'contains', params.custpage_order_number_filter]
        );
    }

    const internalIdColumn = search.createColumn({
        name: 'internalid',
        sort: search.Sort.ASC
    });

    const fromLocationColumn = search.createColumn({
        name: 'location'
    });

    try {
        const fromLocationSearch = search.create({
            type: search.Type.TRANSACTION,
            filters: fromLocationFilters,
            columns: [
                internalIdColumn,
                fromLocationColumn
            ]
        });

        const pagedResults = fromLocationSearch.runPaged({
            pageSize: 1000
        });

        for (let pageIndex = 0; pageIndex < pagedResults.pageRanges.length; pageIndex++) {
            const page = pagedResults.fetch({
                index: pageIndex
            });

            page.data.forEach(searchResult => {
                const orderId = String(searchResult.getValue(internalIdColumn) || '');

                if (!orderId || result.fromLocationByOrderId[orderId]) {
                    return;
                }

                result.ids.push(orderId);
                result.fromLocationByOrderId[orderId] =
                    searchResult.getText(fromLocationColumn) ||
                    searchResult.getValue(fromLocationColumn) ||
                    '';
            });
        }
    } catch (e) {
        result.ids = [];
        result.fromLocationByOrderId = {};
        result.searchFailed = true;

        log.error({
            title: 'Unable to resolve Transfer Orders by From Location',
            details: formatErrorForLog(e)
        });
    }

    return result;
}

function buildInternalIdAnyOfExpression(internalIds) {
    const ids = Array.from(new Set(
        (internalIds || []).map(value => String(value || '')).filter(Boolean)
    ));

    if (!ids.length) {
        /*
         * Transaction internal IDs start above zero, so this is a valid
         * always-false filter without relying on the @NONE@ search token.
         */
        return ['internalid', 'anyof', '0'];
    }

    const expression = [];

    for (let start = 0; start < ids.length; start += 1000) {
        if (expression.length) {
            expression.push('OR');
        }

        expression.push([
            'internalid',
            'anyof',
            ids.slice(start, start + 1000)
        ]);
    }

    return expression.length === 1 ? expression[0] : expression;
}

function buildSelectedLocationExpression(
    transactionTypes,
    locationId,
    transferFromLocationData
) {
    const clauses = [];
    const includesSalesOrders = transactionTypes.indexOf(TRAN_TYPE_SALES_ORDER) !== -1;
    const includesTransferOrders = transactionTypes.indexOf(TRAN_TYPE_TRANSFER_ORDER) !== -1;

    if (includesSalesOrders) {
        clauses.push([
            ['type', 'anyof', TRAN_TYPE_SALES_ORDER],
            'AND',
            ['location', 'anyof', locationId]
        ]);
    }

    if (includesTransferOrders) {
        const transferLocationFilter = transferFromLocationData.searchFailed
            ? ['location', 'anyof', locationId]
            : buildInternalIdAnyOfExpression(transferFromLocationData.ids);

        clauses.push([
            ['type', 'anyof', TRAN_TYPE_TRANSFER_ORDER],
            'AND',
            transferLocationFilter
        ]);
    }

    if (!clauses.length) {
        return ['internalid', 'anyof', '0'];
    }

    return clauses.length === 1
        ? clauses[0]
        : [clauses[0], 'OR', clauses[1]];
}
  
    function getEligibleSalesOrders(params) {
const transactionTypeFilter = params[FLD_TRANSACTION_TYPE_FILTER] || '';
const transactionTypes = transactionTypeFilter
    ? [transactionTypeFilter]
    : [
        TRAN_TYPE_SALES_ORDER,
        TRAN_TYPE_TRANSFER_ORDER
    ];

const selectedLocationId = params.custpage_location_filter || '';
const transferFromLocationData =
    selectedLocationId && transactionTypes.indexOf(TRAN_TYPE_TRANSFER_ORDER) !== -1
        ? getTransferOrdersByFromLocation(selectedLocationId, params)
        : {
            ids: [],
            fromLocationByOrderId: {},
            searchFailed: false
        };

const filters = [
    ['type', 'anyof', transactionTypes],
    'AND',
    ['mainline', 'is', 'F'],
    'AND',
    ['taxline', 'is', 'F'],
    'AND',
    ['shipping', 'is', 'F'],
    'AND',
    ['cogs', 'is', 'F'],
    'AND',
    ['closed', 'is', 'F'],
    'AND',
    ['quantity', 'greaterthan', '0'],
    'AND',
    ['shipmethod', 'anyof', SHIP_METHOD_SIMPLEX_DELIVERY],
    'AND',
    ['status', 'noneof', [
        'SalesOrd:C',
        'SalesOrd:G',
        'SalesOrd:H'
    ]]
];

      const availabilityFilter = params.custpage_availability_filter || 'ANY_OPEN';

if (availabilityFilter === 'IGNORE') {
    // No committed quantity filter.
    // This shows open SO lines even if NetSuite has not committed inventory.
    filters.push(
        'AND',
        ['formulanumeric: NVL({quantity},0) - NVL({quantityshiprecv},0)', 'greaterthan', '0']
    );
}

if (availabilityFilter === 'SOME_COMMITTED') {
    filters.push(
        'AND',
        ['formulanumeric: NVL({quantity},0) - NVL({quantityshiprecv},0)', 'greaterthan', '0'],
        'AND',
        ['quantitycommitted', 'greaterthan', '0']
    );
}

if (availabilityFilter === 'ANY_OPEN') {
    filters.push(
        'AND',
        ['formulanumeric: NVL({quantity},0) - NVL({quantityshiprecv},0)', 'greaterthan', '0']
    );
}

if (availabilityFilter === 'ALL_FULLY_COMMITTED') {
    /*
     * Initial line-level filter:
     * only lines where remaining qty is fully committed.
     *
     * We will do an order-level validation after the grouped search
     * to make sure every fulfillable line on the order is fully committed.
     */
    filters.push(
        'AND',
        [
            'formulanumeric: CASE WHEN NVL({quantity},0) - NVL({quantityshiprecv},0) > 0 AND NVL({quantitycommitted},0) >= NVL({quantity},0) - NVL({quantityshiprecv},0) THEN 1 ELSE 0 END',
            'equalto',
            '1'
        ]
    );
}
      
    if (params.custpage_order_number_filter) {
        filters.push('AND', ['tranid', 'contains', params.custpage_order_number_filter]);
    }

    if (params.custpage_customer_filter) {
        filters.push('AND', ['entity', 'anyof', params.custpage_customer_filter]);
    }

if (params.custpage_zone_filter) {
    filters.push('AND', ['customer.custentity_simplex_zone', 'anyof', params.custpage_zone_filter]);
}

if (selectedLocationId) {
    filters.push(
        'AND',
        buildSelectedLocationExpression(
            transactionTypes,
            selectedLocationId,
            transferFromLocationData
        )
    );
}

const createdDateSort =
    (params.custpage_created_sort || 'DESC') === 'ASC'
        ? search.Sort.ASC
        : search.Sort.DESC;

const createdDateColumn = search.createColumn({
    name: 'datecreated',
    summary: search.Summary.GROUP,
    sort: createdDateSort
});

const internalIdColumn = search.createColumn({
    name: 'internalid',
    summary: search.Summary.GROUP,
    sort: search.Sort.ASC
});

const totalColumn = search.createColumn({
    name: 'total',
    summary: search.Summary.MAX
});

const soSearch = search.create({
    type: search.Type.TRANSACTION,
    filters,
    columns: [
        createdDateColumn,
        internalIdColumn,
        search.createColumn({
            name: 'type',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'tranid',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'entity',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'shipaddress',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'trandate',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'shipdate',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'otherrefnum',
            summary: search.Summary.GROUP
        }),
        totalColumn,
        search.createColumn({
            name: 'entitystatus',
            join: 'customer',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            // NetSuite's "Memo (Main)" search field returns the transaction
            // header memo even though this search is grouped from item lines.
            name: 'memomain',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'currency',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'statusref',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'location',
            summary: search.Summary.GROUP
        }),
        search.createColumn({
            name: 'transferlocation',
            summary: search.Summary.GROUP
        }),
    ]
});

    const results = [];
    const orderIds = [];

    const requestedPageIndexRaw = parseInt(params[FLD_PAGE_INDEX] || '0', 10);
    const requestedPageIndex = isNaN(requestedPageIndexRaw) || requestedPageIndexRaw < 0
        ? 0
        : requestedPageIndexRaw;

    const pagedResults = soSearch.runPaged({
        pageSize: PAGE_SIZE
    });

    const pageCount = pagedResults.pageRanges.length;
    const pageIndex = pageCount
        ? Math.min(requestedPageIndex, pageCount - 1)
        : 0;

    if (pageCount) {
        const currentPage = pagedResults.fetch({
            index: pageIndex
        });

        currentPage.data.forEach(result => {
            const id = result.getValue(internalIdColumn);

            orderIds.push(id);

            const transactionType = result.getValue({
                name: 'type',
                summary: search.Summary.GROUP
            }) || TRAN_TYPE_SALES_ORDER;

            const isTransferOrder = transactionType === TRAN_TYPE_TRANSFER_ORDER;

            const transferLocationText = result.getText({
                name: 'transferlocation',
                summary: search.Summary.GROUP
            }) || '';

            results.push({
        id,
        recordType: isTransferOrder ? record.Type.TRANSFER_ORDER : record.Type.SALES_ORDER,
        transactionType,
        typeLabel: isTransferOrder ? 'Transfer Order' : 'Sales Order',
        tranid: result.getValue({
            name: 'tranid',
            summary: search.Summary.GROUP
        }),
        customer: isTransferOrder
            ? (transferLocationText ? 'Transfer To: ' + transferLocationText : '')
            : result.getText({
                name: 'entity',
                summary: search.Summary.GROUP
            }),
        shipAddress: result.getValue({
            name: 'shipaddress',
            summary: search.Summary.GROUP
        }) || '',
        trandate: result.getValue({
            name: 'trandate',
            summary: search.Summary.GROUP
        }),
        shipdate: result.getValue({
            name: 'shipdate',
            summary: search.Summary.GROUP
        }),
        po: result.getValue({
            name: 'otherrefnum',
            summary: search.Summary.GROUP
        }),
        total: result.getValue(totalColumn),
        holdCode: result.getText({
            name: 'entitystatus',
            join: 'customer',
            summary: search.Summary.GROUP
        }),
        memo: result.getValue({
            name: 'memomain',
            summary: search.Summary.GROUP
        }),
        currency: result.getText({
            name: 'currency',
            summary: search.Summary.GROUP
        }),
        status: result.getText({
            name: 'statusref',
            summary: search.Summary.GROUP
        }),
        createdDate: result.getValue(createdDateColumn),
        location: isTransferOrder
            ? (
                transferFromLocationData.fromLocationByOrderId[String(id)] ||
                result.getText({
                    name: 'location',
                    summary: search.Summary.GROUP
                }) ||
                ''
            )
            : (
                result.getText({
                    name: 'location',
                    summary: search.Summary.GROUP
                }) ||
                ''
            ),
        items: []
    });
        });
    }

/*
 * De-dupe the grouped transaction search results.
 * The search is line-level because mainline = F, so one Sales Order can appear
 * more than once when multiple item lines match the criteria.
 */
let finalResults = getUniqueOrdersById(results);

const uniqueOrderIds = finalResults.map(order => order.id);

if ((params.custpage_availability_filter || 'SOME_COMMITTED') === 'ALL_FULLY_COMMITTED') {
    const fullyCommittedMap = getFullyCommittedOrderMap(uniqueOrderIds);

    finalResults = finalResults.filter(order => {
        return fullyCommittedMap[order.id] === true;
    });
}

/*
 * Exclude Sales Orders that already have at least one Item Fulfillment.
 * This means partially fulfilled Sales Orders will no longer show.
 */
const fulfilledOrderMap = getSalesOrdersWithItemFulfillments(
    finalResults.map(order => order.id)
);

finalResults = finalResults.filter(order => {
    return fulfilledOrderMap[order.id] !== true;
});

const finalOrderIds = finalResults.map(order => order.id);
const itemDetailsByOrder = getOrderItemDetails(finalOrderIds);

finalResults.forEach(order => {
    order.items = itemDetailsByOrder[order.id] || [];

    order.totalWeight = roundNumber(
        order.items.reduce((total, line) => {
            return total + Number(line.extWeightValue || 0);
        }, 0),
        5
    );
});

return {
    orders: finalResults,
    pageIndex,
    pageCount,
    resultCount: pagedResults.count,
    pageSize: PAGE_SIZE,
    rawPageResultCount: results.length,
    visibleResultCount: finalResults.length,
    hasPrevious: pageIndex > 0,
    hasNext: pageIndex < pageCount - 1
};

}
  function getFullyCommittedOrderMap(orderIds) {
    const map = {};

    if (!orderIds || !orderIds.length) {
        return map;
    }

    orderIds.forEach(orderId => {
        map[orderId] = true;
    });

    const lineSearch = search.create({
        type: search.Type.TRANSACTION,
        filters: [
            ['type', 'anyof', [
                TRAN_TYPE_SALES_ORDER,
                TRAN_TYPE_TRANSFER_ORDER
            ]],
            'AND',
            ['internalid', 'anyof', orderIds],
            'AND',
            ['mainline', 'is', 'F'],
            'AND',
            ['taxline', 'is', 'F'],
            'AND',
            ['shipping', 'is', 'F'],
            'AND',
            ['cogs', 'is', 'F'],
            'AND',
            ['closed', 'is', 'F'],
            'AND',
            ['quantity', 'greaterthan', '0'],
            'AND',
            ['formulanumeric: NVL({quantity},0) - NVL({quantityshiprecv},0)', 'greaterthan', '0']
        ],
        columns: [
            search.createColumn({
                name: 'internalid'
            }),
            search.createColumn({
                name: 'quantity'
            }),
            search.createColumn({
                name: 'quantityshiprecv'
            }),
            search.createColumn({
                name: 'quantitycommitted'
            })
        ]
    });

    lineSearch.run().each(result => {
        const orderId = result.getValue({
            name: 'internalid'
        });

        const quantity = Number(result.getValue({
            name: 'quantity'
        }) || 0);

        const fulfilled = Number(result.getValue({
            name: 'quantityshiprecv'
        }) || 0);

        const committed = Number(result.getValue({
            name: 'quantitycommitted'
        }) || 0);

        const remaining = Math.max(quantity - fulfilled, 0);

        if (remaining > 0 && committed < remaining) {
            map[orderId] = false;
        }

        return true;
    });

    return map;
}
function getSalesOrdersWithItemFulfillments(orderIds) {
    const map = {};

    if (!orderIds || !orderIds.length) {
        return map;
    }

    const fulfillmentSearch = search.create({
        type: search.Type.ITEM_FULFILLMENT,
        filters: [
            ['mainline', 'is', 'T'],
            'AND',
            ['createdfrom', 'anyof', orderIds]
        ],
        columns: [
            search.createColumn({
                name: 'createdfrom'
            })
        ]
    });

    fulfillmentSearch.run().each(result => {
        const salesOrderId = result.getValue({
            name: 'createdfrom'
        });

        if (salesOrderId) {
            map[salesOrderId] = true;
        }

        return true;
    });

    return map;
}

function getOrderItemDetails(orderIds) {
    const details = {};

    if (!orderIds || !orderIds.length) {
        return details;
    }

    const quantityUomColumn = search.createColumn({
        name: 'quantityuom'
    });

    const unitColumn = search.createColumn({
        name: 'unit'
    });

    const itemSearch = search.create({
        type: search.Type.TRANSACTION,
        filters: [
            ['type', 'anyof', [
                TRAN_TYPE_SALES_ORDER,
                TRAN_TYPE_TRANSFER_ORDER
            ]],
            'AND',
            ['internalid', 'anyof', orderIds],
            'AND',
            ['mainline', 'is', 'F'],
            'AND',
            ['taxline', 'is', 'F'],
            'AND',
            ['shipping', 'is', 'F'],
            'AND',
            ['cogs', 'is', 'F'],
            'AND',
            ['closed', 'is', 'F'],
            'AND',
            ['quantity', 'greaterthan', '0']
        ],
        columns: [
            search.createColumn({
                name: 'internalid',
                sort: search.Sort.ASC
            }),
            search.createColumn({
                name: 'line',
                sort: search.Sort.ASC
            }),
            search.createColumn({
                name: 'item'
            }),
            search.createColumn({
                name: 'memo'
            }),
            search.createColumn({
                name: 'salesdescription',
                join: 'item'
            }),
            search.createColumn({
                name: 'displayname',
                join: 'item'
            }),
            search.createColumn({
                name: 'quantity'
            }),
            quantityUomColumn,
            search.createColumn({
                name: 'quantitycommitted'
            }),
            search.createColumn({
                name: 'quantityshiprecv'
            }),
            unitColumn,
            search.createColumn({
                name: 'amount'
            }),
            search.createColumn({
                name: 'weight',
                join: 'item'
            })
        ]
    });

    itemSearch.run().each(result => {
        const orderId = result.getValue({
            name: 'internalid'
        });

        /*
         * baseOrderQty is usually the base/stock unit quantity.
         * orderQtyUom is the Sales Order transaction-unit quantity.
         *
         * Example:
         * baseOrderQty = 4800
         * orderQtyUom = 200
         * unit = CS
         */
        const baseOrderQty = Number(result.getValue({
            name: 'quantity'
        }) || 0);

        const orderQtyUom = Number(result.getValue(quantityUomColumn) || baseOrderQty || 0);

        const fulfilledBaseQty = Number(result.getValue({
            name: 'quantityshiprecv'
        }) || 0);

        const committedBaseQty = Number(result.getValue({
            name: 'quantitycommitted'
        }) || 0);

        const amount = Number(result.getValue({
            name: 'amount'
        }) || 0);

        const itemWeight = Number(result.getValue({
            name: 'weight',
            join: 'item'
        }) || 0);

        /*
         * Convert base quantities back to transaction units.
         * Example:
         * 4800 base / 200 CS = 24 base units per CS.
         */
        const conversionRate =
            orderQtyUom && baseOrderQty
                ? baseOrderQty / orderQtyUom
                : 1;

        const fulfilledQtyUom =
            conversionRate
                ? fulfilledBaseQty / conversionRate
                : fulfilledBaseQty;

        const committedQtyUom =
            conversionRate
                ? committedBaseQty / conversionRate
                : committedBaseQty;

        const shipQtyUom =
            committedQtyUom > 0
                ? committedQtyUom
                : Math.max(orderQtyUom - fulfilledQtyUom, 0);

        const unitPrice =
            orderQtyUom
                ? amount / orderQtyUom
                : 0;

        const salesOrderDescription = result.getValue({
    name: 'memo'
}) || '';

const itemSalesDescription = result.getValue({
    name: 'salesdescription',
    join: 'item'
}) || '';

const line = {
    line: result.getValue({
        name: 'line'
    }),
    item: result.getText({
        name: 'item'
    }) || '',
    displayName: result.getValue({
        name: 'displayname',
        join: 'item'
    }) || '',
    description: salesOrderDescription || itemSalesDescription,
    orderQty: formatDisplayNumber(orderQtyUom),
    shipQty: formatDisplayNumber(shipQtyUom),
unit: result.getText(unitColumn) || result.getValue(unitColumn) || '',
    unitPrice: formatDisplayNumber(unitPrice),
    extended: formatDisplayNumber(amount),
    extWeightValue: itemWeight && shipQtyUom
    ? roundNumber(itemWeight * (shipQtyUom * conversionRate), 5)
    : 0,
    extWeight: itemWeight && shipQtyUom
    ? formatDisplayNumber(itemWeight * (shipQtyUom * conversionRate))
    : ''
};

        if (!details[orderId]) {
            details[orderId] = [];
        }

        details[orderId].push(line);

        return true;
    });

    return details;
}

function getTransactionTranId(recordType, internalId) {
    if (!internalId) {
        return '';
    }

    try {
        const lookup = search.lookupFields({
            type: recordType,
            id: internalId,
            columns: ['tranid']
        });

        return lookup.tranid || String(internalId);
    } catch (e) {
        log.error({
            title: `Unable to lookup tranid for ${recordType} ${internalId}`,
            details: e
        });

        return String(internalId);
    }
}
  function roundNumber(value, decimals) {
    const multiplier = Math.pow(10, decimals || 2);
    return Math.round(Number(value || 0) * multiplier) / multiplier;
}
function formatDisplayNumber(value) {
    const num = Number(value || 0);

    if (Number.isInteger(num)) {
        return String(num);
    }

    return String(roundNumber(num, 4));
}

function writeJsonResponse(context, payload) {
    context.response.setHeader({
        name: 'Content-Type',
        value: 'application/json; charset=UTF-8'
    });

    context.response.write({
        output: JSON.stringify(payload)
    });
}

function formatErrorForLog(error) {
    if (!error) {
        return 'Unknown error';
    }

    return [
        error.name || 'Error',
        error.message || String(error),
        error.stack || ''
    ].filter(Boolean).join('\n');
}

function isUsageLimitError(error) {
    const errorName = String(
        (error && (error.name || error.code)) ||
        (error && error.cause && (error.cause.name || error.cause.code)) ||
        ''
    );

    return errorName === 'SSS_USAGE_LIMIT_EXCEEDED';
}

function normalizeSourceRecordType(recordTypeValue) {
    return recordTypeValue === record.Type.TRANSFER_ORDER || recordTypeValue === 'transferorder'
        ? record.Type.TRANSFER_ORDER
        : record.Type.SALES_ORDER;
}

function getExistingItemFulfillment(sourceId) {
    if (!sourceId) {
        return null;
    }

    try {
        const existingSearch = search.create({
            type: search.Type.ITEM_FULFILLMENT,
            filters: [
                ['mainline', 'is', 'T'],
                'AND',
                ['createdfrom', 'anyof', sourceId]
            ],
            columns: [
                search.createColumn({
                    name: 'internalid'
                }),
                search.createColumn({
                    name: 'tranid'
                })
            ]
        });

        const existingResults = existingSearch.run().getRange({
            start: 0,
            end: 1
        });

        if (!existingResults || !existingResults.length) {
            return null;
        }

        return {
            id: existingResults[0].getValue({
                name: 'internalid'
            }),
            tranId: existingResults[0].getValue({
                name: 'tranid'
            }) || ''
        };
    } catch (e) {
        log.error({
            title: `Unable to check existing fulfillment for source transaction ${sourceId}`,
            details: formatErrorForLog(e)
        });

        /* Do not block normal fulfillment if the duplicate-safety search is unavailable. */
        return null;
    }
}

function processOneFulfillment(order, params) {
    const sourceId = String(order.soId || '');
    const sourceRecordType = normalizeSourceRecordType(order.recordType);
    const sourceLabel = sourceRecordType === record.Type.TRANSFER_ORDER
        ? 'Transfer Order'
        : 'Sales Order';
    const sourceTranId = String(order.tranId || sourceId || 'Unknown');
    const pickerToSet = params.custpage_picker_value || order.picker || '';
    const truckToSet = params.custpage_truck_value || order.truck || '';
    const tripNumberToSet = params.custpage_trip_number_value || order.tripNumber || '';

    if (!sourceId || !/^\d+$/.test(sourceId)) {
        throw new Error('A valid source transaction internal ID is required.');
    }

    if (!pickerToSet) {
        throw new Error('Picker is required.');
    }

    if (!truckToSet) {
        throw new Error('Truck Number is required.');
    }

    if (!tripNumberToSet) {
        throw new Error('Trip # is required.');
    }

    const remainingUsage = runtime.getCurrentScript().getRemainingUsage();

    if (remainingUsage < MIN_USAGE_TO_START_ORDER) {
        const usageError = new Error(
            `Not enough governance remains to safely start ${sourceLabel} ${sourceTranId}. ` +
            'Refresh the page and submit this order again.'
        );
        usageError.name = 'SPX_INSUFFICIENT_USAGE';
        throw usageError;
    }

    const existingFulfillment = getExistingItemFulfillment(sourceId);

    if (existingFulfillment) {
        const existingLogisticsResult = updateSourceOrderLogistics(
            sourceRecordType,
            sourceId,
            pickerToSet,
            truckToSet,
            tripNumberToSet
        );

        if (!existingLogisticsResult.updated) {
            return {
                success: true,
                status: 'warning',
                sourceId,
                sourceTranId,
                fulfillmentId: existingFulfillment.id,
                message:
                    `${sourceLabel} ${sourceTranId}: Item Fulfillment ` +
                    `${existingFulfillment.tranId || existingFulfillment.id} already exists, ` +
                    `but the source logistics fields could not be updated (${existingLogisticsResult.message}). ` +
                    'Leave this order selected and click Submit again to retry the source update.'
            };
        }

        return {
            success: true,
            status: 'skipped',
            sourceId,
            sourceTranId,
            fulfillmentId: existingFulfillment.id,
            message:
                `${sourceLabel} ${sourceTranId}: skipped because Item Fulfillment ` +
                `${existingFulfillment.tranId || existingFulfillment.id} already exists; ` +
                'the source logistics fields were verified.'
        };
    }

    const fulfillmentResult = createItemFulfillment({
        sourceRecordType,
        salesOrderId: sourceId,
        fulfillmentDate: params.custpage_fulfillment_date,
        picker: pickerToSet,
        truck: truckToSet,
        tripNumber: tripNumberToSet
    });

    /*
     * Keep the source transaction logistics fields in sync, but never report a
     * successfully saved Item Fulfillment as failed solely because this later
     * source update could not finish.
     */
    const logisticsResult = updateSourceOrderLogistics(
        sourceRecordType,
        sourceId,
        pickerToSet,
        truckToSet,
        tripNumberToSet
    );

    if (!logisticsResult.updated) {
        return {
            success: true,
            status: 'warning',
            sourceId,
            sourceTranId,
            fulfillmentId: fulfillmentResult.id,
            message:
                `${sourceLabel} ${sourceTranId}: Item Fulfillment ${fulfillmentResult.tranId} created, ` +
                `but the source logistics fields could not be updated (${logisticsResult.message}). ` +
                'Leave this order selected and click Submit again to retry the source update.'
        };
    }

    return {
        success: true,
        status: 'success',
        sourceId,
        sourceTranId,
        fulfillmentId: fulfillmentResult.id,
        message: `${sourceLabel} ${sourceTranId}: Item Fulfillment ${fulfillmentResult.tranId} created.`
    };
}

function processFulfillments(context) {
    const request = context.request;
    const params = request.parameters || {};
    const isAsyncRequest = params[ASYNC_FULFILL_PARAM] === 'T';
    let selectedSalesOrders = [];

    try {
        const parsedPayload = JSON.parse(params.custpage_fulfillment_payload || '[]');
        selectedSalesOrders = Array.isArray(parsedPayload) ? parsedPayload : [];
    } catch (e) {
        selectedSalesOrders = [];
    }

    if (!selectedSalesOrders.length) {
        const noSelectionMessage = 'No orders were selected.';

        if (isAsyncRequest) {
            writeJsonResponse(context, {
                success: false,
                message: noSelectionMessage,
                results: [{
                    success: false,
                    status: 'error',
                    message: noSelectionMessage
                }]
            });
        } else {
            renderForm(context, noSelectionMessage);
        }
        return;
    }

    /* The async browser workflow intentionally submits exactly one order. */
    const ordersToProcess = isAsyncRequest
        ? selectedSalesOrders.slice(0, 1)
        : selectedSalesOrders;
    const results = [];

    for (let i = 0; i < ordersToProcess.length; i++) {
        const order = ordersToProcess[i] || {};

        if (
            !isAsyncRequest &&
            i > 0 &&
            runtime.getCurrentScript().getRemainingUsage() < MIN_USAGE_TO_START_ORDER
        ) {
            results.push({
                success: false,
                status: 'error',
                sourceId: String(order.soId || ''),
                message:
                    `${order.tranId || ('Order ' + (order.soId || 'Unknown'))}: not processed because ` +
                    'the safe governance reserve was reached. Refresh and submit the remaining order(s).'
            });
            break;
        }

        try {
            results.push(processOneFulfillment(order, params));
        } catch (e) {
            const sourceRecordType = normalizeSourceRecordType(order.recordType);
            const sourceLabel = sourceRecordType === record.Type.TRANSFER_ORDER
                ? 'Transfer Order'
                : 'Sales Order';
            const sourceName = order.tranId || order.soId || 'Unknown';

            log.error({
                title: `Fulfillment failed for ${sourceLabel} ${sourceName}`,
                details: formatErrorForLog(e)
            });

            results.push({
                success: false,
                status: 'error',
                sourceId: String(order.soId || ''),
                sourceTranId: String(sourceName),
                message: `${sourceLabel} ${sourceName}: FAILED - ${e.message || e}`
            });
        }
    }

    if (isAsyncRequest) {
        writeJsonResponse(context, {
            success: results.every(result => result.status !== 'error'),
            results,
            remainingUsage: runtime.getCurrentScript().getRemainingUsage()
        });
        return;
    }

    renderForm(context, results.map(result => result.message).join('\n'));
}

    function createItemFulfillment(options) {
const {
    sourceRecordType,
    salesOrderId,
    locationId,
    fulfillmentDate,
    postingPeriod,
    shipVia,
    picker,
    truck,
    tripNumber
} = options;

        const fulfillment = record.transform({
            fromType: sourceRecordType || record.Type.SALES_ORDER,
            fromId: salesOrderId,
            toType: record.Type.ITEM_FULFILLMENT,
            isDynamic: false
        });

        if (fulfillmentDate) {
            fulfillment.setValue({
                fieldId: 'trandate',
                value: parseDate(fulfillmentDate)
            });
        }

        if (postingPeriod) {
            fulfillment.setValue({
                fieldId: 'postingperiod',
                value: postingPeriod
            });
        }

        if (shipVia) {
            fulfillment.setValue({
                fieldId: 'shipmethod',
                value: shipVia
            });
        }
        if (picker) {
    fulfillment.setValue({
        fieldId: 'custbody_simplex_picked_by',
        value: picker
    });
}


if (truck) {
    fulfillment.setValue({
        fieldId: 'custbody_truck',
        value: truck
    });
}

if (tripNumber) {
    fulfillment.setValue({
        fieldId: TRIP_NUMBER_FIELD_ID,
        value: tripNumber
    });
}

        const lineCount = fulfillment.getLineCount({
            sublistId: 'item'
        });

        let hasReceivableLine = false;

        for (let i = 0; i < lineCount; i++) {
            const remainingQty = Number(
                fulfillment.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantityremaining',
                    line: i
                }) || 0
            );

            const committedQty = Number(
                fulfillment.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantitycommitted',
                    line: i
                }) || 0
            );

            let qtyToFulfill = committedQty > 0 ? committedQty : remainingQty;

            if (qtyToFulfill > remainingQty) {
                qtyToFulfill = remainingQty;
            }

            if (qtyToFulfill > 0) {
                fulfillment.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    line: i,
                    value: true
                });

                fulfillment.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: i,
                    value: qtyToFulfill
                });

                if (locationId) {
                    fulfillment.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'location',
                        line: i,
                        value: locationId
                    });
                }

                hasReceivableLine = true;
            } else {
                fulfillment.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    line: i,
                    value: false
                });
            }
        }

        if (!hasReceivableLine) {
            throw new Error('No fulfillable lines were found on the transformed Item Fulfillment.');
        }

        const fulfillmentId = fulfillment.save({
    enableSourcing: true,
    ignoreMandatoryFields: false
});

return {
    id: fulfillmentId,
    tranId: getTransactionTranId(record.Type.ITEM_FULFILLMENT, fulfillmentId)
};
    }

    function parseDate(dateString) {
        return format.parse({
            value: dateString,
            type: format.Type.DATE
        });
    }

    function getTodayString() {
        return format.format({
            value: new Date(),
            type: format.Type.DATE
        });
    }
    
    function printPickingTickets(context) {
    const selectedJson =
        context.request.parameters[FIELD_SELECTED] || '[]';

    let selectedOrders;

    try {
        selectedOrders = JSON.parse(selectedJson);
    } catch (e) {
        throw new Error('Unable to read selected orders.');
    }

    const selectedIds = [];
    const selectedIdMap = {};

    selectedOrders.forEach(order => {
        const id = String((order && order.id) || '');

        if (id && !selectedIdMap[id]) {
            selectedIds.push(id);
            selectedIdMap[id] = true;
        }
    });

    if (!selectedIds.length) {
        throw new Error(
            'Please select at least one order to print.'
        );
    }

    assertSafePrintBatchSize(selectedIds.length);

    /*
     * The existing Client Script only needs to submit transaction IDs.
     * Resolve whether each selected ID is a Sales Order or Transfer Order
     * here on the server.
     */
    const transactionRefs =
        resolveTransactionTypes(selectedIds);

    if (!transactionRefs.length) {
        throw new Error(
            'Unable to identify the selected transaction(s).'
        );
    }

    const validation =
        validatePrintableTransactions(transactionRefs);

    if (validation.invalidOrders.length) {
        throw new Error(
            'The following transaction(s) can no longer be printed: ' +
            validation.invalidOrders.join(', ')
        );
    }

    const fulfillmentMap = getItemFulfillmentNumberMap(
        validation.validTransactions.map(ref => ref.id)
    );

    const salesOrdersWithoutFulfillment =
        validation.validTransactions
            .filter(ref => (
                ref.recordType === 'salesorder' &&
                !fulfillmentMap[String(ref.id)]
            ))
            .map(ref => ref.number || ref.id);

    if (salesOrdersWithoutFulfillment.length) {
        throw createNamedError(
            'PT_ITEM_FULFILLMENT_REQUIRED',
            'Picking tickets cannot be printed for these Sales Orders ' +
            'because they do not have an active Item Fulfillment: ' +
            salesOrdersWithoutFulfillment.join(', ') + '. Refresh the ' +
            'page after the Item Fulfillment has been created.'
        );
    }

    const orders = getPickingTicketData(
        validation.validTransactions,
        fulfillmentMap
    );

    if (!orders.length) {
        throw new Error(
            'No printable picking ticket data was found for ' +
            'the selected transaction(s).'
        );
    }

    populateVendorItemCodes(orders);

    ensureUsageForPdfAndPrintedFlags(
        validation.validTransactions.length
    );

    const logoUrl = getLogoUrl();
    const xml = buildPdfSetXml(orders, logoUrl);

    const pdfFile = render.xmlToPdf({
        xmlString: xml
    });

    pdfFile.name = 'Picking_Tickets.pdf';

    markTransactionsAsPrinted(
        validation.validTransactions
    );

    log.audit({
        title: 'Picking Tickets Generated',
        details: JSON.stringify({
            transactionCount: orders.length,
            remainingUsage:
                runtime.getCurrentScript().getRemainingUsage()
        })
    });

    context.response.writeFile({
        file: pdfFile,
        isInline: true
    });
}

function resolveTransactionTypes(transactionIds) {
    const refs = [];
    const seen = {};

    search.create({
        type: search.Type.TRANSACTION,
        filters: [
            ['internalid', 'anyof', transactionIds],
            'AND',
            ['mainline', 'is', 'T'],
            'AND',
            ['type', 'anyof', [
                'SalesOrd',
                'TrnfrOrd'
            ]]
        ],
        columns: [
            search.createColumn({ name: 'internalid' }),
            search.createColumn({ name: 'type' }),
            search.createColumn({ name: 'tranid' }),
            search.createColumn({ name: SO_FIELD_PICKER }),
            search.createColumn({ name: SO_FIELD_TRUCK }),
            search.createColumn({ name: SO_FIELD_TRIP })
        ]
    }).run().each(result => {
        const id = String(
            result.getValue({ name: 'internalid' })
        );

        if (seen[id]) {
            return true;
        }

        const typeValue =
            result.getValue({ name: 'type' }) || '';

        const typeText =
            result.getText({ name: 'type' }) || '';

        let recordType = '';

        if (
            typeValue === 'SalesOrd' ||
            /sales order/i.test(typeText)
        ) {
            recordType = 'salesorder';
        } else if (
            typeValue === 'TrnfrOrd' ||
            /transfer order/i.test(typeText)
        ) {
            recordType = 'transferorder';
        }

        if (recordType) {
            refs.push({
                id: id,
                recordType: recordType,
                number:
                    result.getValue({ name: 'tranid' }) || id,
                picker: getSearchDisplayValue(
                    result,
                    SO_FIELD_PICKER
                ),
                truck: getSearchDisplayValue(
                    result,
                    SO_FIELD_TRUCK
                ),
                trip: getSearchDisplayValue(
                    result,
                    SO_FIELD_TRIP
                )
            });
            seen[id] = true;
        }

        return true;
    });

    return refs;
}

function validatePrintableTransactions(transactionRefs) {
    const validTransactions = [];
    const invalidOrders = [];
    const validIdMap = {};
    const salesOrderIds = transactionRefs
        .filter(ref => ref.recordType === 'salesorder')
        .map(ref => ref.id);
    const transferOrderIds = transactionRefs
        .filter(ref => ref.recordType === 'transferorder')
        .map(ref => ref.id);

    /*
     * Validate each transaction type in one search. The previous version ran
     * one 10-unit ResultSet.each() for every selected transaction.
     */
    if (salesOrderIds.length) {
        search.create({
            type: search.Type.SALES_ORDER,
            filters: [
                ['internalid', 'anyof', salesOrderIds],
                'AND',
                ['mainline', 'is', 'T'],
                'AND',
                ['status', 'noneof', [
                    'SalesOrd:C',
                    'SalesOrd:G',
                    'SalesOrd:H'
                ]]
            ],
            columns: [
                search.createColumn({ name: 'internalid' })
            ]
        }).run().each(result => {
            const id = String(
                result.getValue({ name: 'internalid' }) || ''
            );

            if (id) {
                validIdMap[id] = true;
            }

            return true;
        });
    }

    if (transferOrderIds.length) {
        search.create({
            type: search.Type.TRANSFER_ORDER,
            filters: [
                ['internalid', 'anyof', transferOrderIds],
                'AND',
                ['mainline', 'is', 'T'],
                'AND',
                ['voided', 'is', 'F']
            ],
            columns: [
                search.createColumn({ name: 'internalid' })
            ]
        }).run().each(result => {
            const id = String(
                result.getValue({ name: 'internalid' }) || ''
            );

            if (id) {
                validIdMap[id] = true;
            }

            return true;
        });
    }

    transactionRefs.forEach(ref => {
        if (validIdMap[String(ref.id)]) {
            validTransactions.push(ref);
        } else {
            invalidOrders.push(ref.number || ref.id);
        }
    });

    return {
        validTransactions: validTransactions,
        invalidOrders: invalidOrders
    };
}

function markTransactionsAsPrinted(transactionRefs) {
    const printedFieldId = getPrintedFieldId();

    if (!printedFieldId) {
        return;
    }

    transactionRefs.forEach(ref => {
        try {
            if (
                runtime.getCurrentScript().getRemainingUsage() <
                (10 + PRINT_FINALIZATION_BUFFER)
            ) {
                throw createNamedError(
                    'PT_INSUFFICIENT_USAGE',
                    'NetSuite governance became too low while marking ' +
                    'the printed transactions. Print a smaller batch.'
                );
            }

            const recordType =
                ref.recordType === 'transferorder'
                    ? record.Type.TRANSFER_ORDER
                    : record.Type.SALES_ORDER;

            record.submitFields({
                type: recordType,
                id: ref.id,
                values: {
                    [printedFieldId]: true
                },
                options: {
                    enableSourcing: false,
                    ignoreMandatoryFields: true
                }
            });
        } catch (e) {
            if (
                isUsageLimitError(e) ||
                (e && e.name === 'PT_INSUFFICIENT_USAGE')
            ) {
                throw e;
            }

            log.error({
                title:
                    'Unable to mark transaction as printed: ' +
                    ref.id,
                details: serializeError(e)
            });
        }
    });
}

    function getPickingTicketData(transactionRefs, fulfillmentMap) {
    return transactionRefs
        .map(ref => {
            if (ref.recordType === 'transferorder') {
                return buildPickingTicketFromTransferOrder(
                    ref,
                    fulfillmentMap[ref.id] || ''
                );
            }

            return buildPickingTicketFromSalesOrder(
                ref,
                fulfillmentMap[ref.id] || ''
            );
        })
        .filter(order => (
            order &&
            order.lines &&
            order.lines.length
        ));
}

function buildPickingTicketFromSalesOrder(
    transactionRef,
    fulfillmentNumbers
) {
    const salesOrderId = transactionRef.id;
    const soRec = record.load({
        type: record.Type.SALES_ORDER,
        id: salesOrderId,
        isDynamic: false
    });

const order = {
    id: String(salesOrderId),
    recordType: 'salesorder',
    typeLabel: 'Sales Order',
    date: soRec.getText({ fieldId: 'trandate' }) || soRec.getValue({ fieldId: 'trandate' }) || '',
    number: soRec.getValue({ fieldId: 'tranid' }) || '',
    customer: soRec.getText({ fieldId: 'entity' }) || '',
    shipTo: cleanPdfAddress(soRec.getValue({ fieldId: 'shipaddress' }) || ''),
    shipVia: soRec.getText({ fieldId: 'shipmethod' }) || '',
location: soRec.getText({ fieldId: 'location' }) || '',
salesRep: soRec.getText({ fieldId: 'salesrep' }) ||
    soRec.getValue({ fieldId: 'salesrep' }) || '',
enteredBy: soRec.getText({ fieldId: SO_FIELD_SALES_REP }) ||
    soRec.getValue({ fieldId: SO_FIELD_SALES_REP }) || '',
pickingTicketMemo:
    soRec.getValue({ fieldId: SO_FIELD_PICKING_TICKET_MEMO }) || '',
picker: getRecordDisplayValue(soRec, SO_FIELD_PICKER) ||
    transactionRef.picker || '',
truck: getRecordDisplayValue(soRec, SO_FIELD_TRUCK) ||
    transactionRef.truck || '',
trip: getRecordDisplayValue(soRec, SO_FIELD_TRIP) ||
    transactionRef.trip || '',
fulfillmentNumbers: fulfillmentNumbers,
lines: []
};

    const lineCount = soRec.getLineCount({
        sublistId: 'item'
    });

    for (let i = 0; i < lineCount; i++) {
        const isClosed = soRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'isclosed',
            line: i
        });

        if (isClosed === true || isClosed === 'T') {
            continue;
        }

        const itemType = soRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'itemtype',
            line: i
        });

        if (['Description', 'Discount', 'Markup', 'Subtotal', 'Group', 'EndGroup'].indexOf(itemType) !== -1) {
            continue;
        }

const itemId = soRec.getSublistValue({
    sublistId: 'item',
    fieldId: 'item',
    line: i
});

const code = soRec.getSublistText({
    sublistId: 'item',
    fieldId: 'item',
    line: i
}) || '';

        const description =
            soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'description',
                line: i
            }) || '';

        const quantity = toNumber(soRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'quantity',
            line: i
        }));

        const quantityFulfilled = toNumber(soRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'quantityfulfilled',
            line: i
        }));

        const quantityCommitted = toNumber(soRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'quantitycommitted',
            line: i
        }));

        const quantityAvailable = soRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'quantityavailable',
            line: i
        });

        const units = soRec.getSublistText({
            sublistId: 'item',
            fieldId: 'units',
            line: i
        }) || '';

        const qtyRemaining = Math.max(quantity - quantityFulfilled, 0);

        /*
         * Use Sales Order display quantity, not base-unit quantity.
         * This matches the XML/UI value, e.g. 200 CS instead of 4800 base units.
         */
        const qtyToPrint = quantityCommitted > 0 ? quantityCommitted : qtyRemaining;

order.lines.push({
    code: code,
    vendorItemCode: '',
    itemId: itemId,
    itemType: itemType,
    description: description,
    quantity: qtyRemaining,
    committed: quantityCommitted,
    pickQty: qtyToPrint,
    units: units,
    onHand: quantityAvailable || '',
    location: soRec.getSublistText({
        sublistId: 'item',
        fieldId: 'location',
        line: i
    }) || order.location
});
    }

    return order;
}

function buildPickingTicketFromTransferOrder(
    transactionRef,
    fulfillmentNumbers
) {
    const transferOrderId = transactionRef.id;
    const toRec = record.load({
        type: record.Type.TRANSFER_ORDER,
        id: transferOrderId,
        isDynamic: false
    });

    const destination =
        toRec.getText({ fieldId: 'transferlocation' }) || '';

    const order = {
        id: String(transferOrderId),
        recordType: 'transferorder',
        typeLabel: 'Transfer Order',
        date:
            toRec.getText({ fieldId: 'trandate' }) ||
            toRec.getValue({ fieldId: 'trandate' }) ||
            '',
        number:
            toRec.getValue({ fieldId: 'tranid' }) || '',
        customer: destination,
        shipTo: cleanPdfAddress(
            toRec.getValue({ fieldId: 'shipaddress' }) || ''
        ),
        shipVia:
            toRec.getText({ fieldId: 'shipmethod' }) || '',
        location:
            toRec.getText({ fieldId: 'location' }) || '',
        salesRep: '',
        enteredBy: '',
        pickingTicketMemo: '',
        picker: getRecordDisplayValue(
            toRec,
            SO_FIELD_PICKER
        ) || transactionRef.picker || '',
        truck: getRecordDisplayValue(
            toRec,
            SO_FIELD_TRUCK
        ) || transactionRef.truck || '',
        trip: getRecordDisplayValue(
            toRec,
            SO_FIELD_TRIP
        ) || transactionRef.trip || '',
        fulfillmentNumbers: fulfillmentNumbers,
        lines: []
    };

    const lineCount = toRec.getLineCount({
        sublistId: 'item'
    });

    for (let i = 0; i < lineCount; i++) {
        const isClosed = toRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'isclosed',
            line: i
        });

        if (isClosed === true || isClosed === 'T') {
            continue;
        }

        const itemType = toRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'itemtype',
            line: i
        });

        if (
            [
                'Description',
                'Discount',
                'Markup',
                'Subtotal',
                'Group',
                'EndGroup'
            ].indexOf(itemType) !== -1
        ) {
            continue;
        }

        const itemId = toRec.getSublistValue({
            sublistId: 'item',
            fieldId: 'item',
            line: i
        });

        const code = toRec.getSublistText({
            sublistId: 'item',
            fieldId: 'item',
            line: i
        }) || '';

        const description =
            toRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'description',
                line: i
            }) || '';

        const quantity = toNumber(
            toRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: i
            })
        );

        const quantityFulfilled = toNumber(
            toRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantityfulfilled',
                line: i
            })
        );

        const qtyRemaining =
            Math.max(quantity - quantityFulfilled, 0);

        /*
         * Normal printing uses the remaining quantity.
         * If this is a reprint after fulfillment, preserve the
         * original Transfer Order quantity instead of printing 0.
         */
        const qtyToPrint =
            qtyRemaining > 0
                ? qtyRemaining
                : quantity;

        const units = toRec.getSublistText({
            sublistId: 'item',
            fieldId: 'units',
            line: i
        }) || '';

        order.lines.push({
            code: code,
            vendorItemCode: '',
            itemId: itemId,
            itemType: itemType,
            description: description,
            quantity: qtyRemaining,
            committed: 0,
            pickQty: qtyToPrint,
            units: units,
            onHand: '',
            location: order.location
        });
    }

    return order;
}


function getItemSearchType(itemType) {
    switch (itemType) {
        case 'InvtPart':
            return search.Type.INVENTORY_ITEM;

        case 'Assembly':
            return search.Type.ASSEMBLY_ITEM;

        case 'NonInvtPart':
            return search.Type.NON_INVENTORY_ITEM;

        case 'Service':
            return search.Type.SERVICE_ITEM;

        case 'OthCharge':
            return search.Type.OTHER_CHARGE_ITEM;

        default:
            return '';
    }
}

function populateVendorItemCodes(orders) {
    const searchGroups = {};

    orders.forEach(order => {
        order.lines.forEach(line => {
            const itemId = String(line.itemId || '');
            const itemType = String(line.itemType || '');
            const searchType = getItemSearchType(itemType);
            const cacheKey = itemType + ':' + itemId;

            if (!itemId || !searchType) {
                vendorItemCodeCache[cacheKey] = '';
                return;
            }

            if (
                Object.prototype.hasOwnProperty.call(
                    vendorItemCodeCache,
                    cacheKey
                )
            ) {
                return;
            }

            const groupKey = String(searchType);

            if (!searchGroups[groupKey]) {
                searchGroups[groupKey] = {
                    searchType: searchType,
                    items: {}
                };
            }

            searchGroups[groupKey].items[itemId] = itemType;
            vendorItemCodeCache[cacheKey] = '';
        });
    });

    Object.keys(searchGroups).forEach(groupKey => {
        const group = searchGroups[groupKey];
        const itemIds = Object.keys(group.items);

        if (!itemIds.length) {
            return;
        }

        try {
            search.create({
                type: group.searchType,
                filters: [
                    ['internalid', 'anyof', itemIds]
                ],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'vendorname' })
                ]
            }).run().each(result => {
                const itemId = String(
                    result.getValue({ name: 'internalid' }) || ''
                );
                const itemType = group.items[itemId] || '';

                if (itemId && itemType) {
                    vendorItemCodeCache[itemType + ':' + itemId] = String(
                        result.getValue({ name: 'vendorname' }) || ''
                    );
                }

                return true;
            });
        } catch (e) {
            /*
             * Preserve the old per-item lookup as an exceptional fallback.
             * Governance is checked before every lookup so this path cannot
             * consume the units reserved for PDF generation and marking.
             */
            itemIds.forEach(itemId => {
                const itemType = group.items[itemId];
                const cacheKey = itemType + ':' + itemId;
                const unitsNeededToFinish =
                    (orders.length * 10) +
                    PRINT_FINALIZATION_BUFFER +
                    10;

                if (
                    runtime.getCurrentScript().getRemainingUsage() <=
                    unitsNeededToFinish
                ) {
                    throw createNamedError(
                        'PT_INSUFFICIENT_USAGE',
                        'NetSuite could not batch-load Vendor Item Codes and ' +
                        'does not have enough usage for individual lookups. ' +
                        'Print a smaller batch.'
                    );
                }

                const itemData = search.lookupFields({
                    type: group.searchType,
                    id: itemId,
                    columns: ['vendorname']
                });

                vendorItemCodeCache[cacheKey] = String(
                    itemData.vendorname || ''
                );
            });

            log.error({
                title: 'Vendor Item Code batch search used fallback',
                details: serializeError(e)
            });
        }
    });

    orders.forEach(order => {
        order.lines.forEach(line => {
            const cacheKey =
                String(line.itemType || '') + ':' +
                String(line.itemId || '');

            line.vendorItemCode = vendorItemCodeCache[cacheKey] || '';
        });
    });
}

function getItemFulfillmentNumberMap(transactionIds) {
    const fulfillmentMap = {};
    const seenByTransaction = {};
    const uniqueTransactionIds = [];
    const transactionIdSet = {};

    if (!transactionIds || !transactionIds.length) {
        return fulfillmentMap;
    }

    transactionIds.forEach(id => {
        const stringId = String(id || '');

        if (!stringId || transactionIdSet[stringId]) {
            return;
        }

        transactionIdSet[stringId] = true;
        uniqueTransactionIds.push(stringId);
        fulfillmentMap[stringId] = [];
        seenByTransaction[stringId] = {};
    });

    try {
        chunkArray(
            uniqueTransactionIds,
            SEARCH_FILTER_ID_CHUNK_SIZE
        ).forEach(idChunk => {
            search.create({
                type: search.Type.ITEM_FULFILLMENT,
                filters: [
                    ['mainline', 'is', 'T'],
                    'AND',
                    ['createdfrom', 'anyof', idChunk],
                    'AND',
                    ['voided', 'is', 'F']
                ],
                columns: [
                    search.createColumn({ name: 'createdfrom' }),
                    search.createColumn({
                        name: 'trandate',
                        sort: search.Sort.ASC
                    }),
                    search.createColumn({
                        name: 'tranid',
                        sort: search.Sort.ASC
                    })
                ]
            }).run().each(result => {
                const sourceId = String(
                    result.getValue({ name: 'createdfrom' }) || ''
                );
                const fulfillmentNumber = String(
                    result.getValue({ name: 'tranid' }) || ''
                );

                if (
                    sourceId &&
                    fulfillmentNumber &&
                    fulfillmentMap[sourceId] &&
                    !seenByTransaction[sourceId][fulfillmentNumber]
                ) {
                    fulfillmentMap[sourceId].push(fulfillmentNumber);
                    seenByTransaction[sourceId][fulfillmentNumber] = true;
                }

                return true;
            });
        });
    } catch (e) {
        log.error({
            title: 'Unable to batch-load Item Fulfillment numbers',
            details: serializeError(e)
        });

        /*
         * Fail closed. An unavailable fulfillment search must never be
         * mistaken for proof that an order has no fulfillment, and printing
         * must not continue when the prerequisite cannot be verified.
         */
        throw createNamedError(
            'PT_FULFILLMENT_LOOKUP_FAILED',
            'NetSuite could not verify the Item Fulfillments. No picking ' +
            'tickets were printed. Details: ' + getErrorMessage(e)
        );
    }

    Object.keys(fulfillmentMap).forEach(id => {
        fulfillmentMap[id] = fulfillmentMap[id].join(', ');
    });

    return fulfillmentMap;
}

function chunkArray(values, chunkSize) {
    const chunks = [];

    for (let start = 0; start < values.length; start += chunkSize) {
        chunks.push(values.slice(start, start + chunkSize));
    }

    return chunks;
}
function cleanPdfAddress(value) {
    if (!value) {
        return '';
    }

    return String(value)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\r/g, '')
        .trim();
}

    function buildPdfSetXml(orders, logoUrl) {
        let pdfs = '';

        orders.forEach(order => {
            pdfs += buildSinglePickingTicketPdf(order, logoUrl);
        });

        return `<?xml version="1.0"?>
            <!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
            <pdfset>
                ${pdfs}
            </pdfset>`;
    }

    function buildSinglePickingTicketPdf(order, logoUrl) {
    const lines = order.lines.map(line => `
    <tr>
        <td class="code-column">
            ${xmlEscape(line.code)}
        </td>

        <td class="vendor-item-column">
            ${xmlEscape(line.vendorItemCode)}
        </td>

        <td class="description-column">
            ${xmlEscape(line.description)}
        </td>

            <td class="quantity-column">
                ${formatQty(line.pickQty)}
            </td>

            <td class="unit-column">
                ${xmlEscape(line.units)}
            </td>

            <td class="picked-column">
                &nbsp;
            </td>

            <td class="onhand-column last-cell">
                ${formatQty(line.onHand)}
            </td>
        </tr>
    `).join('');

    const blankRows = '';

    const logoHtml = logoUrl
        ? `
            <img
                src="${xmlEscape(logoUrl)}"
                style="width:155px;height:39px;"
            />
        `
        : `
            <span style="font-size:17pt;font-weight:bold;color:#174f7a;">
                SIMPLEX
            </span>
            <br/>
            <span style="font-size:6pt;letter-spacing:1px;color:#666666;">
                TRADING CO. LTD.
            </span>
        `;

    return `
        <pdf>
            <head>
                <macrolist>
                    <macro id="ticketFooter">
                        <table class="footer-table">
                            <tr>
                                <td style="width:30%;">
                                    <barcode
                                        codetype="code128"
                                        showtext="true"
                                        value="${xmlEscape(order.number)}"
                                    />
                                </td>

                                <td style="width:40%;">
                                    &nbsp;
                                </td>

                                <td style="width:30%;text-align:right;">
                                    <pagenumber/> of <totalpages/>
                                </td>
                            </tr>
                        </table>
                    </macro>
                </macrolist>

                <style>
                    body {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 10pt;
    color: #222222;
}

                    table {
                        width: 100%;
                        border-collapse: collapse;
                        table-layout: fixed;
                    }

                    td {
                        padding: 0;
                    }

                    .date-order-table {
                        border: 0.75px solid #222222;
                    }

                    .date-order-table td {
                        border-right: 0.75px solid #222222;
                        padding: 3px;
                    }

                    .date-order-table td.last-date-cell {
                        border-right: none;
                    }

                    .date-order-header td {
    border-bottom: 0.75px solid #222222;
    font-size: 9pt;
    font-weight: bold;
}

.date-order-value td {
    font-size: 10pt;
}

.fulfillment-row {
    margin-top: 3px;
    font-size: 9pt;
}

.fulfillment-label {
    font-weight: bold;
}

.fulfillment-value {
    font-size: 10pt;
}

                    .ship-box {
                        border: 0.75px solid #222222;
                        padding: 4px;
                        height: 58px;
                        vertical-align: top;
                    }

                    .ship-label {
    font-size: 10pt;
    font-weight: bold;
}

                    .ship-address {
    font-size: 10pt;
    line-height: 12pt;
}

                    .assignment-label {
    padding-bottom: 2px;
    font-size: 10pt;
    font-weight: bold;
    text-align: center;
}

                    .assignment-value {
    border: 0.75px solid #222222;
    padding: 3px;
    height: 16px;
    font-size: 10pt;
    text-align: center;
}

                    .rep-info-table {
                        margin-top: 6px;
                    }

                    .rep-info-label {
                        font-size: 9pt;
                        font-weight: bold;
                        padding-bottom: 2px;
                    }

                    .rep-info-value {
                        border: 0.75px solid #222222;
                        padding: 3px 4px;
                        height: 16px;
                        font-size: 10pt;
                    }

                    .memo-table {
                        margin-top: 6px;
                        border: 0.75px solid #222222;
                    }

                    .memo-label {
                        padding: 3px 4px 2px 4px;
                        font-size: 9pt;
                        font-weight: bold;
                    }

                    .memo-value {
                        padding: 3px 4px 5px 4px;
                        font-size: 10pt;
                        line-height: 12pt;
                    }

                    .item-table {
                        border: 0.75px solid #222222;
                    }

                    .item-table th {
    border-right: 0.75px solid #222222;
    border-bottom: 0.75px solid #222222;
    padding: 5px 4px;
    font-size: 10pt;
    font-weight: bold;
    text-align: left;
    vertical-align: middle;
}

                    .item-table th.last-header {
                        border-right: none;
                    }

.item-table td {
    border-right: 0.75px solid #222222;
    padding: 4px;
    font-size: 10pt;
    vertical-align: top;
}

                    .item-table td.last-cell {
                        border-right: none;
                    }

.code-column {
    width: 12%;
}

.vendor-item-column {
    width: 14%;
}

.description-column {
    width: 28%;
}

.quantity-column {
    width: 7%;
    text-align: right;
}

.unit-column {
    width: 8%;
    text-align: center;
}

.picked-column {
    width: 14%;
    text-align: center;
}

.onhand-column {
    width: 17%;
    text-align: right;
}

                    .footer-table td {
                        padding: 0;
                        font-size: 8pt;
                        vertical-align: bottom;
                    }
                </style>
            </head>

            <body
                footer="ticketFooter"
                footer-height="32pt"
                padding="0.28in"
                size="Letter"
            >

                <!-- Logo and Date / Order -->
                <table>
                    <tr>
                        <td style="width:64%;vertical-align:top;">
                            ${logoHtml}
                        </td>

                        <td style="width:2%;">
                            &nbsp;
                        </td>

                        <td style="width:34%;vertical-align:top;">
<table class="date-order-table">
    <tr class="date-order-header">
        <td style="width:50%;">
            DATE
        </td>

        <td
            class="last-date-cell"
            style="width:50%;"
        >
            ORDER #
        </td>
    </tr>

    <tr class="date-order-value">
        <td>
            ${xmlEscape(order.date)}
        </td>

        <td class="last-date-cell">
            ${xmlEscape(order.number)}
        </td>
    </tr>
</table>

<table class="fulfillment-row">
    <tr>
        <td>
            <span class="fulfillment-label">
                ITEM FULFILLMENT #
            </span>

            <span class="fulfillment-value">
                ${xmlEscape(order.fulfillmentNumbers) || '&nbsp;'}
            </span>
        </td>
    </tr>
</table>
                        </td>
                    </tr>
                </table>

                <div style="height:5px;">
                    &nbsp;
                </div>

                <!-- Ship To, Picker and Truck -->
                <table>
                    <tr>
                        <td
                            class="ship-box"
                            style="width:46%;"
                        >
                            <span class="ship-label">
                                SHIP TO:
                            </span>
                            <br/>

                            <span class="ship-address">
                                ${xmlEscape(order.customer)}
                                <br/>
                                ${xmlEscape(order.shipTo).replace(/\n/g, '<br/>')}
                            </span>
                        </td>

<td style="width:8%;">
    &nbsp;
</td>

<td style="width:13%;vertical-align:bottom;">
    <table>
        <tr>
            <td class="assignment-label">
                PICKER
            </td>
        </tr>

        <tr>
            <td class="assignment-value">
                ${xmlEscape(order.picker) || '&nbsp;'}
            </td>
        </tr>
    </table>
</td>

<td style="width:3%;">
    &nbsp;
</td>

<td style="width:13%;vertical-align:bottom;">
    <table>
        <tr>
            <td class="assignment-label">
                TRUCK
            </td>
        </tr>

        <tr>
            <td class="assignment-value">
                ${xmlEscape(order.truck) || '&nbsp;'}
            </td>
        </tr>
    </table>
</td>

<td style="width:3%;">
    &nbsp;
</td>

<td style="width:13%;vertical-align:bottom;">
    <table>
        <tr>
            <td class="assignment-label">
                TRIP #
            </td>
        </tr>

        <tr>
            <td class="assignment-value">
                ${xmlEscape(order.trip) || '&nbsp;'}
            </td>
        </tr>
    </table>
</td>

<td style="width:1%;">
    &nbsp;
</td>
                    </tr>
                </table>

                <table class="rep-info-table">
                    <tr>
                        <td style="width:46%;">
                            &nbsp;
                        </td>

                        <td style="width:8%;">
                            &nbsp;
                        </td>

                        <td style="width:21%;vertical-align:top;">
                            <table>
                                <tr>
                                    <td class="rep-info-label">
                                        SALES REP
                                    </td>
                                </tr>
                                <tr>
                                    <td class="rep-info-value">
                                        ${xmlEscape(order.salesRep) || '&nbsp;'}
                                    </td>
                                </tr>
                            </table>
                        </td>

                        <td style="width:3%;">
                            &nbsp;
                        </td>

                        <td style="width:21%;vertical-align:top;">
                            <table>
                                <tr>
                                    <td class="rep-info-label">
                                        ENTERED BY
                                    </td>
                                </tr>
                                <tr>
                                    <td class="rep-info-value">
                                        ${xmlEscape(order.enteredBy) || '&nbsp;'}
                                    </td>
                                </tr>
                            </table>
                        </td>

                        <td style="width:1%;">
                            &nbsp;
                        </td>
                    </tr>
                </table>

                ${order.pickingTicketMemo ? `
                <table class="memo-table">
                    <tr>
                        <td class="memo-label">
                            PICKING TICKET MEMO
                        </td>
                    </tr>
                    <tr>
                        <td class="memo-value">
                            ${xmlEscape(order.pickingTicketMemo)}
                        </td>
                    </tr>
                </table>
                ` : ''}

                <div style="height:10px;">
                    &nbsp;
                </div>

                <!-- Item Lines -->
                <table class="item-table">
                    <thead>
                        <tr>
<th class="code-column">
    CODE
</th>

<th class="vendor-item-column">
    VEN ITEM
</th>

<th class="description-column">
    DESCRIPTION
</th>

                            <th class="quantity-column">
                                QTY
                            </th>

                            <th class="unit-column">
                                UNIT
                            </th>

                            <th class="picked-column">
                                PICKED
                            </th>

                            <th class="onhand-column last-header">
                                ON HAND
                            </th>
                        </tr>
                    </thead>

<tbody>
    ${lines}
</tbody>
                </table>

            </body>
        </pdf>
    `;
}
function assertSafePrintBatchSize(transactionCount) {
    const remainingUsage =
        runtime.getCurrentScript().getRemainingUsage();
    const safeMaximum = Math.max(
        1,
        Math.floor(
            (remainingUsage - PRINT_FIXED_USAGE_RESERVE) /
            PRINT_USAGE_PER_TRANSACTION
        )
    );

    if (transactionCount > safeMaximum) {
        throw createNamedError(
            'PT_BATCH_TOO_LARGE',
            'Select no more than ' + safeMaximum +
            ' transactions per PDF. This protects the print request from ' +
            'NetSuite\'s Suitelet governance limit. Larger selections can ' +
            'be printed in multiple batches.'
        );
    }
}

function ensureUsageForPdfAndPrintedFlags(transactionCount) {
    const remainingUsage =
        runtime.getCurrentScript().getRemainingUsage();
    const requiredUsage =
        (transactionCount * 10) +
        PRINT_FINALIZATION_BUFFER +
        10;

    if (remainingUsage < requiredUsage) {
        throw createNamedError(
            'PT_INSUFFICIENT_USAGE',
            'NetSuite usage is too low to safely finish this print batch. ' +
            'No PDF was generated and no printed flags were changed. ' +
            'Please print a smaller selection.'
        );
    }
}

function getSearchDisplayValue(result, fieldId) {
    try {
        return result.getText({ name: fieldId }) ||
            result.getValue({ name: fieldId }) || '';
    } catch (e) {
        return result.getValue({ name: fieldId }) || '';
    }
}

function getRecordDisplayValue(recordObject, fieldId) {
    try {
        return recordObject.getText({ fieldId: fieldId }) ||
            recordObject.getValue({ fieldId: fieldId }) || '';
    } catch (e) {
        try {
            return recordObject.getValue({ fieldId: fieldId }) || '';
        } catch (ignored) {
            return '';
        }
    }
}

function createNamedError(name, message) {
    const errorObject = new Error(message);
    errorObject.name = name;
    return errorObject;
}

function getErrorMessage(errorObject) {
    if (!errorObject) {
        return 'An unexpected error occurred.';
    }

    return String(
        errorObject.message ||
        errorObject.details ||
        errorObject
    );
}

function serializeError(errorObject) {
    try {
        return JSON.stringify({
            name:
                (errorObject && errorObject.name) || 'ERROR',
            message: getErrorMessage(errorObject),
            stack:
                (errorObject && errorObject.stack) || '',
            causeCode:
                errorObject &&
                errorObject.cause &&
                errorObject.cause.code
                    ? errorObject.cause.code
                    : ''
        });
    } catch (ignored) {
        return getErrorMessage(errorObject);
    }
}
function writeLightweightErrorPage(context, message) {
    context.response.write({
        output: `
            <!doctype html>
            <html>
                <head>
                    <meta charset="utf-8">
                    <title>Print Picking Tickets</title>
                </head>
                <body style="font-family:Arial,sans-serif;padding:24px;">
                    <h2>Picking tickets were not printed</h2>
                    <p>${escapeHtml(message)}</p>
                    <p>
                        Use your browser's Back button, select fewer
                        transactions, and try again.
                    </p>
                </body>
            </html>
        `
    });
}

    function getLogoUrl() {
        const script = runtime.getCurrentScript();
        let logoFileId = script.getParameter({
            name: PARAM_LOGO_FILE_ID
        });

        /*
         * The old Print Picking Tickets deployment may hold the custom logo
         * parameter. When this code is copied over the Fulfill Orders
         * deployment, fall back to the account's Company Logo (Forms).
         */
        if (!logoFileId) {
            try {
                const companyInformation = config.load({
                    type: config.Type.COMPANY_INFORMATION
                });

                logoFileId = companyInformation.getValue({
                    fieldId: 'formlogo'
                }) || '';
            } catch (companyLogoError) {
                log.error({
                    title: 'Unable to resolve Company Logo (Forms)',
                    details: serializeError(companyLogoError)
                });
            }
        }

        if (!logoFileId) {
            return '';
        }

        try {
            const logoFile = file.load({
                id: logoFileId
            });

            return logoFile.url;
        } catch (e) {
            log.error({
                title: 'Unable to load logo file',
                details: e
            });

            return '';
        }
    }

    function getPrintedFieldId() {
    return runtime.getCurrentScript().getParameter({
        name: PARAM_PRINTED_FIELD_ID
    }) || DEFAULT_PRINTED_FIELD_ID;
}

function formatQty(value) {
    const numberValue = parseFloat(value);

    if (isNaN(numberValue)) {
        return value || '';
    }

    if (numberValue % 1 === 0) {
        return String(parseInt(numberValue, 10));
    }

    return String(numberValue);
}

    function toNumber(value) {
        const numberValue = parseFloat(value);
        return isNaN(numberValue) ? 0 : numberValue;
    }
    function xmlEscape(value) {
        if (value === null || value === undefined) {
            return '';
        }

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
function updateSourceOrderLogistics(sourceRecordType, sourceId, picker, truck, tripNumber) {
    if (!sourceId) {
        return {
            updated: false,
            message: 'Source transaction internal ID is missing.'
        };
    }

    const values = {};

    if (picker) {
        values.custbody_simplex_picked_by = picker;
    }

    if (truck) {
        values.custbody_truck = truck;
    }

    if (tripNumber) {
        values[TRIP_NUMBER_FIELD_ID] = tripNumber;
    }

    if (!Object.keys(values).length) {
        return {
            updated: true,
            usedFallback: false
        };
    }

    if (runtime.getCurrentScript().getRemainingUsage() < MIN_USAGE_TO_UPDATE_SOURCE) {
        return {
            updated: false,
            message: 'the Suitelet reached its governance reserve before the source update'
        };
    }

    try {
        record.submitFields({
            type: sourceRecordType || record.Type.SALES_ORDER,
            id: sourceId,
            values,
            options: {
                enableSourcing: false,
                ignoreMandatoryFields: true
            }
        });

        return {
            updated: true,
            usedFallback: false
        };
    } catch (e) {
        if (isUsageLimitError(e)) {
            log.error({
                title: `Governance limit reached updating source transaction ${sourceId}`,
                details: formatErrorForLog(e)
            });

            return {
                updated: false,
                message: e.message || 'Script Execution Usage Limit Exceeded'
            };
        }

        /*
         * Some source transaction types may not have every custom field applied.
         * Retry with Truck and Trip only so Transfer Orders can still retain route info.
         */
        log.error({
            title: `Unable to update all logistics fields on source transaction ${sourceId}`,
            details: formatErrorForLog(e)
        });

        const fallbackValues = {};

        if (truck) {
            fallbackValues.custbody_truck = truck;
        }

        if (tripNumber) {
            fallbackValues[TRIP_NUMBER_FIELD_ID] = tripNumber;
        }

        if (!Object.keys(fallbackValues).length) {
            return {
                updated: false,
                message: e.message || String(e)
            };
        }

        if (runtime.getCurrentScript().getRemainingUsage() < MIN_USAGE_TO_UPDATE_SOURCE) {
            return {
                updated: false,
                message: 'the Suitelet reached its governance reserve before the fallback source update'
            };
        }

        try {
            record.submitFields({
                type: sourceRecordType || record.Type.SALES_ORDER,
                id: sourceId,
                values: fallbackValues,
                options: {
                    enableSourcing: false,
                    ignoreMandatoryFields: true
                }
            });

            return {
                updated: true,
                usedFallback: true
            };
        } catch (fallbackError) {
            log.error({
                title: `Unable to apply fallback logistics fields on source transaction ${sourceId}`,
                details: formatErrorForLog(fallbackError)
            });

            return {
                updated: false,
                message: fallbackError.message || String(fallbackError)
            };
        }
    }
}

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    return {
        onRequest
    };
});
